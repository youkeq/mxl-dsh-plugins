'use strict'

// Vision assist — 视觉辅助（持久化宿主包，v4.1 · dsh-mxl-vision-assist）
// 从 profiles/web/cordis.patch.yml 宿主级挂载，进程重启不丢失。
//
// 原理（v3，请求层转换）：
// 会话日志保留用户发送的原始图片块（UI 正常显示原图+文字），请求派生
// （deriveMessages）也含图。llm/stream 的 loop 请求被 deepFreeze 禁止改写，
// 所以监听器不修改原请求，而是用"图片→视觉模型描述"转换后的消息构造一个
// 新请求并重新走 llm.stream，把新请求的 chunk 流 yield 出去（waterfall
// 契约允许 "yield your own chunks to short-circuit"）。
//
// v4 变更：
// - 日志静默：正常运行不再输出，仅在出错时打印（前缀 [dsh-mxl-vision-assist]）；
// - 新增宿主工具 capture_window：按进程名/窗口标题直接抓取窗口内容
//   （koffi 直调 user32 PrintWindow，无视遮挡/最小化），存为附件后由本插件
//   既有的 llm/stream 管线自动转成【图片识别结果】文本；
// - 设置面板下拉只列声明支持图片的模型（保留当前选中项），标签只显示
//   提供方/模型名；
// - 注册文件 schema 变化时自动刷新（保留 enabled/settings）。
//
// 效果：
// - 消息记录显示用户发的原图+文字（存储层不动）；
// - 主模型请求只收到纯文本（图片块被替换为【图片识别结果】描述）；
// - 历史会话里已存在的图片消息每轮请求都会被转换 → 已污染的会话自动恢复；
// - 工具结果里的图片（任务中截图/读图/capture_window）同样被转换；
// - 视觉模型自身的调用（visionAssist）与转换后的请求（visionPass）直接放行。
//
// 能力声明（llm-pi-ai 模型的 input: image）必须保留：api-proxy 依据它
// 放行图片消息进入会话。声明随面板 enabled 开关自动补/还原。

let koffi = null
let sharp = null
try { koffi = require('koffi') } catch (e) { koffi = null }
try { sharp = require('sharp') } catch (e) { sharp = null }

// ---- 窗口捕获（koffi FFI -> user32 PrintWindow -> sharp PNG）----
function buildCapturer() {
  if (!koffi || !sharp) return null
  try {
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    const gdi32 = koffi.load('gdi32.dll')

    const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc (void* hwnd, long lParam)')
    const EnumWindows = user32.func('EnumWindows', 'bool', [koffi.pointer(EnumWindowsProc), 'void*'])
    const GetWindowTextW = user32.func('int GetWindowTextW(void* hwnd, void* buf, int max)')
    const GetClassNameW = user32.func('int GetClassNameW(void* hwnd, void* buf, int max)')
    const IsWindowVisible = user32.func('bool IsWindowVisible(void* hwnd)')
    const GetWindowRect = user32.func('bool GetWindowRect(void* hwnd, void* rect)')
    const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(void* hwnd, void* pid)')
    const PrintWindow = user32.func('bool PrintWindow(void* hwnd, void* hdc, uint32 flags)')
    const GetDC = user32.func('void* GetDC(void* hwnd)')
    const ReleaseDC = user32.func('int ReleaseDC(void* hwnd, void* dc)')
    const OpenProcess = kernel32.func('void* OpenProcess(uint32 access, bool inherit, uint32 pid)')
    const QueryFullProcessImageNameW = kernel32.func('bool QueryFullProcessImageNameW(void* proc, uint32 flags, void* buf, void* size)')
    const CloseHandle = kernel32.func('bool CloseHandle(void* h)')
    const CreateCompatibleDC = gdi32.func('void* CreateCompatibleDC(void* dc)')
    const CreateCompatibleBitmap = gdi32.func('void* CreateCompatibleBitmap(void* dc, int w, int h)')
    const SelectObject = gdi32.func('void* SelectObject(void* dc, void* obj)')
    const DeleteObject = gdi32.func('bool DeleteObject(void* obj)')
    const DeleteDC = gdi32.func('bool DeleteDC(void* dc)')
    const GetDIBits = gdi32.func('int GetDIBits(void* hdc, void* bmp, uint32 start, uint32 lines, void* bits, void* bmi, uint32 usage)')

    function wstr(buf) {
      const s = buf.toString('utf16le')
      const end = s.indexOf('\0')
      return end < 0 ? s : s.slice(0, end)
    }

    function listWindows() {
      const out = []
      EnumWindows((hwnd) => {
        const titleBuf = Buffer.alloc(1024)
        const classBuf = Buffer.alloc(256)
        const n = GetWindowTextW(hwnd, titleBuf, 512)
        GetClassNameW(hwnd, classBuf, 128)
        const pidBuf = Buffer.alloc(4)
        GetWindowThreadProcessId(hwnd, pidBuf)
        out.push({
          hwnd,
          title: n > 0 ? wstr(titleBuf) : '',
          cls: wstr(classBuf),
          pid: pidBuf.readUInt32LE(0),
          visible: IsWindowVisible(hwnd),
        })
        return true
      }, null)
      return out
    }

    function processNameOf(pid) {
      const h = OpenProcess(0x1000, false, pid)
      if (!h) return ''
      try {
        const buf = Buffer.alloc(1024)
        const size = Buffer.alloc(4)
        size.writeUInt32LE(512, 0)
        if (!QueryFullProcessImageNameW(h, 0, buf, size)) return ''
        const len = size.readUInt32LE(0)
        const p = wstr(buf.subarray(0, len * 2)).replace(/\\/g, '/')
        return p.split('/').pop() || ''
      } finally {
        CloseHandle(h)
      }
    }

    function findWindow(processName, windowTitle) {
      const pn = typeof processName === 'string' && processName.trim().length > 0
        ? processName.trim().toLowerCase().replace(/\.exe$/, '')
        : ''
      const wt = typeof windowTitle === 'string' && windowTitle.trim().length > 0
        ? windowTitle.trim().toLowerCase()
        : ''
      const wins = listWindows()
      const candidates = []
      for (const w of wins) {
        if (!w.visible) continue
        if (pn.length > 0) {
          const got = processNameOf(w.pid).toLowerCase().replace(/\.exe$/, '')
          if (got !== pn) continue
        }
        if (wt.length > 0) {
          if (w.title.toLowerCase().indexOf(wt) < 0) continue
        }
        candidates.push(w)
      }
      if (candidates.length === 0) return null
      if (candidates.length > 1) {
        const titled = candidates.filter((c) => c.title.length > 0)
        if (titled.length > 0) return titled[0]
      }
      return candidates[0]
    }

    function captureWindow(win, scale) {
      const rect = Buffer.alloc(16)
      if (!GetWindowRect(win.hwnd, rect)) throw new Error('GetWindowRect failed')
      const w = rect.readInt32LE(8) - rect.readInt32LE(0)
      const h = rect.readInt32LE(12) - rect.readInt32LE(4)
      if (w <= 0 || h <= 0) throw new Error('window has zero size')
      const screenDC = GetDC(null)
      const memDC = CreateCompatibleDC(screenDC)
      const bmp = CreateCompatibleBitmap(screenDC, w, h)
      const old = SelectObject(memDC, bmp)
      const ok = PrintWindow(win.hwnd, memDC, 2)
      SelectObject(memDC, old)
      const bits = Buffer.alloc(w * h * 4)
      const bmi = Buffer.alloc(40)
      bmi.writeInt32LE(40, 0)
      bmi.writeInt32LE(w, 4)
      bmi.writeInt32LE(-h, 8)
      bmi.writeInt16LE(1, 12)
      bmi.writeInt16LE(32, 14)
      bmi.writeInt32LE(0, 16)
      bmi.writeInt32LE(w * h * 4, 20)
      GetDIBits(memDC, bmp, 0, h, bits, bmi, 0)
      DeleteObject(bmp)
      DeleteDC(memDC)
      ReleaseDC(null, screenDC)
      for (let i = 0; i < bits.length; i += 4) {
        const t = bits[i]
        bits[i] = bits[i + 2]
        bits[i + 2] = t
      }
      const scaleN = Number.isFinite(scale) && scale > 1 ? Math.min(4, Math.floor(scale)) : 1
      let img = sharp(bits, { raw: { width: w, height: h, channels: 4 } })
      if (scaleN > 1) img = img.resize(w * scaleN, h * scaleN)
      return img.png().toBuffer().then((png) => ({
        png,
        width: w * scaleN,
        height: h * scaleN,
        printWindow: ok,
      }))
    }

    return { findWindow, captureWindow, processNameOf }
  } catch (e) {
    console.error('[dsh-mxl-vision-assist] window capturer unavailable:', String(e && e.message || e))
    return null
  }
}

module.exports = {
  inject: ['timer', 'llm', 'attachments', 'fs', 'sandboxPolicy', 'agents', 'settings', 'tools'],
  apply(ctx) {
    const llm = ctx.llm
    const attachments = ctx.attachments
    const fs = ctx.fs
    const sandboxPolicy = ctx.sandboxPolicy
    const agents = ctx.agents
    const settings = ctx.settings
    const tools = ctx.get('tools')
    const REG_NAME = '.dsh-plugin.mxl-vision-assist.json'

    const state = { enabled: true, visionModel: '' }
    const cache = new Map()
    const weSet = new Set()
    let workspacePath = null
    let session = null

    // ---- 工作区发现（agents 主通道 + sandboxPolicy 兜底；轮询中动态重试）----
    function discoverWorkspace() {
      try {
        const list = agents.list()
        for (const a of list) {
          // 注意：session 是 Agent 对象自身的属性（agent.session），不是 a.ctx.session
          // （agent 的 ctx 上没有 session，旧写法会导致工作区发现永远失败）。
          const s = a && a.session
          if (s && s.header && s.header.cwd) {
            workspacePath = s.header.cwd
            session = s
            return
          }
        }
      } catch (e) {}
      // 无活跃会话时：从工作区注册表兜底（启动即有，无需等待会话出现）。
      if (!workspacePath) {
        try {
          const registry = ctx.get('workspaceRegistry')
          if (registry && typeof registry.list === 'function') {
            const workspaces = registry.list()
            if (workspaces && workspaces.length > 0 && typeof workspaces[0].path === 'string') {
              workspacePath = workspaces[0].path
            }
          }
        } catch (e) {}
      }
      if (!workspacePath && sandboxPolicy && sandboxPolicy.workspaceRoot) {
        workspacePath = sandboxPolicy.workspaceRoot
      }
    }

    // ---- 注册文件读取 ----
    let configLoaded = false
    let lastReadFailLog = 0

    // 规范化 visionModel 写法：容忍面板显示文案格式 "provider / model"（空格斜杠）
    // 和 "provider | model"（空格竖线），统一为竖线分隔、去空格。
    // 注意：只处理第一个分隔符；模型 id 内部可能含 "/"，不受影响。
    function normalizeVisionModel(raw) {
      if (typeof raw !== 'string') return raw
      let v = raw.trim()
      if (v.indexOf('|') < 0 && v.indexOf(' / ') >= 0) {
        const parts = v.split(' / ')
        if (parts.length === 2) v = parts[0].trim() + '|' + parts[1].trim()
      } else if (v.indexOf('|') >= 0) {
        const i = v.indexOf('|')
        v = v.slice(0, i).trim() + '|' + v.slice(i + 1).trim()
      }
      return v
    }

    async function readRegistration() {
      if (!workspacePath || !fs) return
      try {
        const target = await fs.resolve(REG_NAME, { cwd: workspacePath })
        const st = await fs.stat(target)
        if (!st) return
        const text = await fs.readText(target)
        const doc = JSON.parse(text)
        if (typeof doc.enabled === 'boolean') state.enabled = doc.enabled
        if (doc.settings && typeof doc.settings.visionModel === 'string') {
          state.visionModel = normalizeVisionModel(doc.settings.visionModel)
        }
        configLoaded = true
      } catch (e) {
        // 读失败日志限流：文件持续损坏时最多 30 秒打一条，避免刷屏。
        const now = Date.now()
        if (now - lastReadFailLog > 30000) {
          lastReadFailLog = now
          console.error('[dsh-mxl-vision-assist] registration read failed:', String(e && e.message || e))
        }
      }
    }

    // ---- 注册文件写入（缺失时创建；schema 变化时刷新，保留 enabled/settings）----
    function buildSchemaOptions() {
      const opts = []
      try {
        const resolved = settings.get('llm-pi-ai')
        const providers = (resolved && resolved.providers) || {}
        for (const pname of Object.keys(providers)) {
          const pconf = providers[pname]
          const models = pconf && typeof pconf === 'object' && pconf.models
          if (!Array.isArray(models)) continue
          for (const m of models) {
            if (!m || typeof m !== 'object' || typeof m.id !== 'string') continue
            const vision = Array.isArray(m.input) && m.input.includes('image')
            const key = pname + '|' + m.id
            if (!vision && key !== state.visionModel) continue
            opts.push({ value: key, label: pname + ' / ' + (m.name || m.id) })
          }
        }
      } catch (e) {}
      return opts
    }

    // 智能默认：取用户自己设置里第一个声明支持图片的模型；一个都没有才退回内置默认。
    function firstVisionModel() {
      const opts = buildSchemaOptions()
      return opts.length > 0 ? opts[0].value : null
    }

    async function writeRegistration() {
      if (!workspacePath || !fs || !sandboxPolicy) return
      try {
        const target = await fs.resolve(REG_NAME, { cwd: workspacePath })
        const policy = sandboxPolicy.resolve(session ? { session } : {})
        const schema = [
          { key: 'visionModel', label: '视觉识别模型', type: 'select', options: buildSchemaOptions() },
        ]
        const existing = await fs.stat(target)
        if (existing) {
          let next = null
          try {
            const text = await fs.readText(target)
            const doc = JSON.parse(text)
            if (doc !== null && typeof doc === 'object' && !Array.isArray(doc)) {
              const oldSchema = Array.isArray(doc.schema) ? doc.schema : null
              if (JSON.stringify(oldSchema) !== JSON.stringify(schema)) {
                next = Object.assign({}, doc, { schema })
              }
            }
          } catch (e) {}
          if (next !== null) {
            await fs.writeText(target, JSON.stringify(next, null, 2), undefined, undefined, policy)
          }
          return
        }
        const doc = {
          id: 'mxl-vision-assist',
          name: '视觉辅助',
          description: '主模型不支持图片时，自动调用视觉模型识别图片并生成文字描述后继续对话',
          enabled: true,
          schema,
          settings: { visionModel: firstVisionModel() || '' },
        }
        await fs.writeText(target, JSON.stringify(doc, null, 2), undefined, undefined, policy)
      } catch (e) {
        console.error('[dsh-mxl-vision-assist] registration write failed:', String(e && e.message || e))
      }
    }

    // ---- 能力声明管理（api-proxy 放行图片所必需）----
    async function ensureDeclarations() {
      if (!settings) return
      try {
        const resolved = settings.get('llm-pi-ai')
        const providers = resolved && resolved.providers
        if (!providers || typeof providers !== 'object') return
        const patch = { providers: {} }
        for (const pname of Object.keys(providers)) {
          const pconf = providers[pname]
          const models = pconf && typeof pconf === 'object' && pconf.models
          if (!Array.isArray(models)) continue
          let changed = false
          const newModels = models.map((m) => {
            if (!m || typeof m !== 'object' || typeof m.id !== 'string') return m
            const input = Array.isArray(m.input) ? m.input : []
            if (input.includes('image')) return m
            const clone = Object.assign({}, m)
            clone.input = ['text', 'image']
            changed = true
            weSet.add(pname + '|' + m.id)
            return clone
          })
          if (changed) {
            patch.providers[pname] = { models: newModels }
          }
        }
        if (!Object.keys(patch.providers).length) return
        await settings.update('llm-pi-ai', patch)
      } catch (e) {
        console.error('[dsh-mxl-vision-assist] ensure declarations failed:', String(e && e.message || e))
      }
    }

    async function restoreDeclarations() {
      if (!settings || !weSet.size) return
      try {
        const resolved = settings.get('llm-pi-ai')
        if (!resolved || typeof resolved !== 'object') return
        const section = { providers: {} }
        const providers = resolved.providers
        if (providers && typeof providers === 'object') {
          for (const pname of Object.keys(providers)) {
            const pconf = providers[pname]
            if (!pconf || typeof pconf !== 'object') continue
            const pc = Object.assign({}, pconf)
            if (Array.isArray(pconf.models)) {
              const models = pconf.models.map((m) => {
                if (!m || typeof m !== 'object' || typeof m.id !== 'string') return m
                const key = pname + '|' + m.id
                if (!weSet.has(key)) return m
                const input = m.input
                if (!Array.isArray(input) || !input.includes('image')) { weSet.delete(key); return m }
                const clone = Object.assign({}, m)
                delete clone.input
                return clone
              })
              pc.models = models
            }
            section.providers[pname] = pc
          }
        }
        await settings.replace('llm-pi-ai', section)
        weSet.clear()
      } catch (e) {
        console.error('[dsh-mxl-vision-assist] restore declarations failed:', String(e && e.message || e))
      }
    }

    // ---- 图片收集（含 tool-result 嵌套）----
    function collectImages(messages) {
      const found = []
      if (!Array.isArray(messages)) return found
      for (const message of messages) {
        const content = message && message.content
        if (!Array.isArray(content)) continue
        const walk = (blocks, out) => {
          for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i]
            if (!block || typeof block !== 'object') continue
            if (block.type === 'image' && block.attachment && typeof block.attachment.attachmentId === 'string') {
              out.push({ blocks, index: i, ref: block.attachment })
            } else if (block.type === 'tool-result' && Array.isArray(block.content)) {
              walk(block.content, out)
            }
          }
        }
        walk(content, found)
      }
      return found
    }

    // ---- 视觉模型配置容错 ----
    // 防护 1：模型存在性预检（resolveModelInfo，按 visionModel 缓存）——模型 id 配错
    //         （不存在）直接短路，不发请求；
    // 防护 2：连续失败熔断——同一视觉模型连续失败 3 次 → 暂停自动识别 5 分钟，
    //         期间返回明确的"暂不可用"提示，不再反复轰炸 provider；
    // 防护 3：明确的中文诊断——错误文本与控制台日志都指向 visionModel 配置。
    let visionModelInfoCache = new Map()
    let visionFailStreak = 0
    let visionDegradedUntil = 0

    function visionModelParts() {
      const sep = state.visionModel.indexOf('|')
      return {
        provider: sep >= 0 ? state.visionModel.slice(0, sep) : state.visionModel,
        model: sep >= 0 ? state.visionModel.slice(sep + 1) : '',
      }
    }

    // 返回 true 或 { reason }；按 visionModel 值缓存。
    async function visionModelUsable() {
      const cached = visionModelInfoCache.get(state.visionModel)
      if (cached !== undefined) return cached
      const { provider, model } = visionModelParts()
      if (!provider || !model) {
        const reason = state.visionModel
          ? '配置格式错误：visionModel 应为 "provider|model" 格式（provider 与模型名之间用竖线分隔，可参考设置面板"视觉识别模型"下拉中的选项），当前值 "' + state.visionModel + '"'
          : '尚未配置视觉模型：请在注册文件 settings.visionModel 中设置 provider|model'
        visionModelInfoCache.set(state.visionModel, { reason })
        return { reason }
      }
      const llmSvc = ctx.get('llm') || llm
      if (llmSvc && typeof llmSvc.resolveModelInfo === 'function') {
        try {
          await llmSvc.resolveModelInfo(provider, model)
          visionModelInfoCache.set(state.visionModel, true)
          return true
        } catch (e) {
          const reason = String(e && e.message || e).slice(0, 200)
          visionModelInfoCache.set(state.visionModel, { reason })
          return { reason }
        }
      }
      return true
    }

    // ---- 启动/配置变更探测：视觉模型不可用 → 大红错误日志 ----
    // 用真实的最小图片做一次探测调用：
    // - 配置了 baseURL 的 provider → 零落盘 HTTP 探测；
    // - 非直连 provider → 走 harness 管线探测（会留下一个约 100 字节的探测附件）。
    // 探测成功 → 零日志；失败（配错 / 不支持视觉 / 无法连接）→ 大红双语 error。
    // 配置值变更后重新探测（同一配置只探测一次）。
    const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
    let lastProbedVisionKey = null

    function logVisionUnavailable(reason) {
      const R = '\x1b[1;31m'
      const X = '\x1b[0m'
      console.error(R + '[dsh-mxl-vision-assist] ⚠ 视觉辅助服务异常：配置的视觉模型不可用，会话中的图片将无法自动识别，发送图片可能导致请求报错 / Vision assist service unavailable: the configured vision model cannot process images, so image recognition in conversations may fail or trigger request errors' + X)
      console.error(R + '  模型 / model: ' + state.visionModel + X)
      console.error(R + '  原因 / reason: ' + reason + X)
    }

    async function probeVisionModel() {
      if (!state.enabled) return
      // 配置文件被实际读取前不探测：避免用默认配置误探测（默认模型网络慢会拖时间，
      // 且可能对用户未设置的模型误报）。
      if (!configLoaded) return
      if (state.visionModel === lastProbedVisionKey) return
      lastProbedVisionKey = state.visionModel
      const usable = await visionModelUsable()
      if (usable !== true) {
        logVisionUnavailable('配置的模型不存在或无法解析 / configured model does not exist or cannot be resolved: ' + usable.reason)
        return
      }
      const { provider } = visionModelParts()
      try {
        if (directEndpointFor(provider)) {
          await describeImageDirect(TINY_PNG, null, 32)
        } else {
          const ref = await attachments.saveImage({ data: TINY_PNG, mediaType: 'image/png', name: 'vision-probe.png' })
          await describeRef(ref, null, undefined)
        }
        // 探测成功：零日志
      } catch (e) {
        logVisionUnavailable(String(e && e.message || e).slice(0, 300))
      }
    }

    // ---- 视觉描述（视觉辅助模型：visionModel 配置）----
    // 无缓存单次识别（transient 轻量自检用）。
    async function describeRef(ref, userHint, signal) {
      const usable = await visionModelUsable()
      if (usable !== true) {
        throw new Error('配置的视觉模型不可用（' + usable.reason + '），请在注册文件 settings.visionModel 中配置正确的图片模型')
      }
      const { provider, model } = visionModelParts()
      const prompt = '你是视觉辅助模型。请用中文详细描述这张图片的全部可见内容：主体、人物、物体、文字、布局、颜色、氛围等，尽量完整准确。' +
        (userHint ? '\n（用户正在询问：' + userHint.slice(0, 200) + '）' : '')
      await attachments.readImage(ref)
      const messages = [{
        role: 'user',
        content: [
          { type: 'image', attachment: ref },
          { type: 'text', text: prompt },
        ],
      }]
      let text = ''
      const chunks = llm.stream({ provider, model, messages, maxTokens: 700, signal, visionAssist: true })
      for await (const chunk of chunks) {
        if (chunk && chunk.type === 'text-delta') text += chunk.text
        if (chunk && chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') {
          throw new Error('vision model error: ' + JSON.stringify(chunk.reason.failure).slice(0, 200))
        }
      }
      return (text || '').trim()
    }

    // 带缓存识别（会话图片转换用；含熔断保护）。
    async function describeImage(ref, userHint, signal) {
      const key = ref.attachmentId
      const cached = cache.get(key)
      if (cached !== undefined) return cached
      if (Date.now() < visionDegradedUntil) {
        const mins = Math.max(1, Math.ceil((visionDegradedUntil - Date.now()) / 60000))
        const text = '（图片内容不可用：视觉模型连续失败，已暂停自动识别约 ' + mins + ' 分钟；请检查注册文件 settings.visionModel 的模型配置）'
        cache.set(key, text)
        return text
      }
      let desc = ''
      try {
        desc = await describeRef(ref, userHint, signal)
        if (!desc) desc = '（图片内容不可用：视觉模型返回为空）'
        visionFailStreak = 0
      } catch (e) {
        visionFailStreak++
        if (visionFailStreak >= 3) {
          visionDegradedUntil = Date.now() + 5 * 60 * 1000
          console.error('[dsh-mxl-vision-assist] vision model degraded: 连续 ' + visionFailStreak + ' 次失败，暂停自动识别 5 分钟；请检查 visionModel 配置: ' + state.visionModel)
        }
        desc = '（图片内容不可用：' + String(e && e.message || e).slice(0, 120) + '）'
      }
      cache.set(key, desc)
      return desc
    }

    // ---- transient 自检：直接 HTTP 调视觉模型（零持久化，无任何删除逻辑）----
    // - 截图 PNG 只存在于内存，base64 后直接 POST 给视觉模型；
    // - 不创建附件、不进会话日志、不写磁盘 → 根本不需要删除机制；
    // - 调用的是注册文件 settings.visionModel 配置的模型（面板选择或手动配置）；
    // - 直连端点来自用户自己的提供方设置（settings 显式 baseURL）；未配置则明确报错
    //   （绝不静默换模型、绝不降级到持久化路径）。

    // 解析 provider 的直连端点：用户 settings 中显式配置的 baseURL；无则 null。
    function directEndpointFor(provider) {
      let baseURL = null
      try {
        const resolved = settings.get('llm-pi-ai')
        const pconf = resolved && resolved.providers && resolved.providers[provider]
        if (pconf && typeof pconf === 'object' && typeof pconf.baseURL === 'string' && pconf.baseURL.length > 0) {
          baseURL = pconf.baseURL
        }
      } catch (e) {}
      return baseURL || null
    }

    async function describeImageDirect(png, userHint, maxTokens) {
      const usable = await visionModelUsable()
      if (usable !== true) {
        throw new Error('配置的视觉模型不可用（' + usable.reason + '），请在注册文件 settings.visionModel 中配置正确的图片模型')
      }
      if (Date.now() < visionDegradedUntil) {
        throw new Error('视觉模型连续失败，暂停自动识别约 ' + Math.max(1, Math.ceil((visionDegradedUntil - Date.now()) / 60000)) + ' 分钟，请稍后再试或检查 visionModel 配置')
      }
      const { provider, model } = visionModelParts()
      const baseURL = directEndpointFor(provider)
      if (!baseURL) {
        throw new Error('transient 直连不支持 provider "' + provider + '"（该提供方未配置 baseURL，无法直连调用）；请去掉 transient 使用普通截图，或在提供方设置中配置 baseURL')
      }
      let apiKeyEnv = null
      try {
        const resolved = settings.get('llm-pi-ai')
        const pconf = resolved && resolved.providers && resolved.providers[provider]
        if (pconf && typeof pconf === 'object' && typeof pconf.apiKeyEnv === 'string' && pconf.apiKeyEnv.length > 0) {
          apiKeyEnv = pconf.apiKeyEnv
        }
      } catch (e) {}
      if (!apiKeyEnv) apiKeyEnv = provider.toUpperCase().replace(/-/g, '_') + '_API_KEY'
      let key = null
      const creds = ctx.get('credentials')
      if (creds && typeof creds.resolve === 'function') {
        try {
          const hit = await creds.resolve(apiKeyEnv)
          if (hit && typeof hit.value === 'string' && hit.value.length > 0) key = hit.value
        } catch (e) {}
      }
      if (!key) {
        const env = typeof process === 'object' && process !== null && process.env ? process.env : null
        key = env ? env[apiKeyEnv] : undefined
      }
      if (!key) {
        throw new Error('无法获取 provider "' + provider + '" 的 API key（' + apiKeyEnv + ' 未配置）')
      }
      const prompt = '你是视觉辅助模型。请用中文详细描述这张图片的全部可见内容：主体、人物、物体、文字、布局、颜色、氛围等，尽量完整准确。' +
        (userHint ? '\n（用户正在询问：' + userHint.slice(0, 200) + '）' : '')
      const b64 = Buffer.from(png).toString('base64')
      const body = {
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } },
          ],
        }],
        max_tokens: maxTokens || 700,
      }
      const res = await fetch(baseURL + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error('vision HTTP ' + res.status + ': ' + detail.slice(0, 200))
      }
      const data = await res.json()
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
      if (typeof content === 'string') return content.trim()
      if (Array.isArray(content)) {
        return content.map((p) => p && typeof p.text === 'string' ? p.text : '').join('').trim()
      }
      return ''
    }

    // ---- 转换消息 content：移除图片块，把识别结果文本追加到末尾 ----
    // 顺序：[原文本..., 【图片识别结果】...]；明确标注来源，避免主模型
    // 误以为是用户提供的图片描述而跑去查找文件。
    function transformMessageContent(content, descs) {
      let changed = false
      const resultTexts = []
      const out = []
      for (const b of content) {
        if (!b || typeof b !== 'object') {
          out.push(b)
          continue
        }
        if (b.type === 'image' && b.attachment && typeof b.attachment.attachmentId === 'string') {
          changed = true
          const desc = descs.get(b.attachment.attachmentId) || '（图片内容不可用）'
          resultTexts.push('【图片识别结果】\n' + desc)
        } else if (b.type === 'tool-result' && Array.isArray(b.content)) {
          const nested = transformMessageContent(b.content, descs)
          if (nested !== b.content) {
            changed = true
            out.push(Object.assign({}, b, { content: nested }))
          } else {
            out.push(b)
          }
        } else {
          out.push(b)
        }
      }
      if (!changed) return content
      for (const t of resultTexts) out.push({ type: 'text', text: t })
      return out
    }

    // ---- llm/stream：请求层转换（v3 核心）----
    // loop 请求 deepFreeze 不可改写 → 构造新请求（图片→描述）重新走 llm.stream，
    // 把新请求的 chunk 流 yield 出去。日志/UI 保留原图。
    ctx.on('llm/stream', (options, next) => {
      if (!state.enabled) return next()
      if (!options || !Array.isArray(options.messages)) return next()
      if (options.visionAssist || options.visionPass) return next()
      const found = collectImages(options.messages)
      if (!found.length) return next()
      // 主模型路由：只放行视觉模型本身（visionModel 配置），其余一律转换。
      // 不能用 inputModalities 判断：api-proxy 放行所需的 input: image 声明
      // 会污染能力查询，导致文本模型被误判为支持图片而跳过转换。
      const vsep = state.visionModel.indexOf('|')
      const visionProvider = vsep >= 0 ? state.visionModel.slice(0, vsep) : state.visionModel
      const visionModel = vsep >= 0 ? state.visionModel.slice(vsep + 1) : ''
      if (options.provider === visionProvider && options.model === visionModel) return next()
      return (async function* () {
        try {
          // 提示文本：最后一条 user 消息的文本
          let hint = ''
          for (let i = options.messages.length - 1; i >= 0; i--) {
            const m = options.messages[i]
            const content = m && m.content
            if (!Array.isArray(content)) continue
            const texts = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text)
            if (texts.length) { hint = texts.join(' '); break }
          }
          // 去重收集图片并逐张识别
          const refs = []
          const seen = new Set()
          for (const item of found) {
            if (!seen.has(item.ref.attachmentId)) {
              seen.add(item.ref.attachmentId)
              refs.push(item.ref)
            }
          }
          const descs = new Map()
          for (const ref of refs) {
            descs.set(ref.attachmentId, await describeImage(ref, hint, options.signal))
          }
          // 构造转换后的消息（新数组；原请求对象不动）
          const newMessages = options.messages.map((m) => {
            if (!m || !Array.isArray(m.content)) return m
            const content = transformMessageContent(m.content, descs)
            return content === m.content ? m : Object.assign({}, m, { content })
          })
          // 新请求：spread 原请求（frozen 可读），替换 messages，打 visionPass 标记防递归
          const newRequest = Object.assign({}, options, { messages: newMessages, visionPass: true })
          yield* llm.stream(newRequest)
        } catch (e) {
          console.error('[dsh-mxl-vision-assist] stream error:', String(e && e.message || e))
          yield* next()
        }
      })()
    })

    // ---- capture_window 宿主工具（截图 → 附件 → 自动走视觉管线）----
    if (tools !== undefined) {
      const capturer = buildCapturer()
      if (capturer !== null) {
        try {
          tools.register({
            name: 'capture_window',
            description: 'Capture the current content of a specific window (Android emulator, game, app, browser page) directly from the window itself, even when it is covered by other windows or minimized. The captured image is returned and the vision pipeline converts it into a text description automatically. Provide process_name (exact process name, e.g. notepad) or window_title (title substring, e.g. Settings); pass scale 2 to enlarge small windows. Pass transient: true for throwaway self-checks: the window is described by the vision model via a direct call and the image stays in memory only — nothing is saved to disk and nothing is recorded in the session.',
            parameters: {
              type: 'object',
              properties: {
                process_name: { type: 'string', description: 'Exact process name of the target window, e.g. notepad (".exe" suffix optional).' },
                window_title: { type: 'string', description: 'Substring of the window title, e.g. Settings. Used when process_name is not provided.' },
                scale: { type: 'integer', description: 'Optional zoom factor 1-4 to enlarge the capture (2 recommended for small windows). Default 1.' },
                transient: { type: 'boolean', description: 'Lightweight self-check mode: capture and describe the window via a direct vision-model HTTP call. The image stays in memory ONLY: nothing is written to disk and nothing is recorded in the session (only the text description remains). Requires the configured vision model provider to have a baseURL configured in settings for direct calls. Use for throwaway visual checks. Default false (persists the screenshot as an attachment like read_image).' },
              },
            },
            output: {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['window'],
                properties: {
                  window: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      title: { type: 'string' },
                      processName: { type: 'string' },
                      pid: { type: 'integer' },
                      width: { type: 'integer' },
                      height: { type: 'integer' },
                    },
                  },
                  description: { type: 'string' },
                  image: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
                    properties: {
                      attachmentId: { type: 'string' },
                      mediaType: { type: 'string' },
                      bytes: { type: 'integer' },
                      width: { type: 'integer' },
                      height: { type: 'integer' },
                      name: { type: 'string' },
                    },
                  },
                },
              },
              render(args, value) {
                const w = value.window
                const img = value.image
                if (typeof value.description === 'string') {
                  return [{
                    type: 'text',
                    text: '<window>' + String(w.title || '') + '</window>\n<process>' + String(w.processName || '') + '</process>\n<type>transient-capture</type>\n<content>\n' + value.description + '\n</content>',
                  }]
                }
                return [
                  {
                    type: 'text',
                    text: '<window>' + String(w.title || '') + '</window>\n<process>' + String(w.processName || '') + '</process>\n<type>image</type>\n<content>\n' + img.mediaType + ' image, ' + img.width + 'x' + img.height + ' px, ' + img.bytes + ' bytes\n</content>',
                  },
                  {
                    type: 'image',
                    attachment: {
                      attachmentId: img.attachmentId,
                      mediaType: img.mediaType,
                      bytes: img.bytes,
                      width: img.width,
                      height: img.height,
                      ...(typeof img.name === 'string' ? { name: img.name } : {}),
                    },
                  },
                ]
              },
            },
            // 有 transient 删除语义，必须串行执行（避免并发去重竞争）。
            isConcurrencySafe: () => false,
            async execute(args) {
              if (typeof args.process_name !== 'string' && typeof args.window_title !== 'string') {
                throw new Error('capture_window: provide process_name or window_title')
              }
              const win = capturer.findWindow(args.process_name, args.window_title)
              if (win === null) {
                throw new Error('capture_window: no visible window matches process_name="' + String(args.process_name || '') + '" window_title="' + String(args.window_title || '') + '"; list running windows first (e.g. Get-Process | Where MainWindowHandle -ne 0) and retry with the exact process name')
              }
              const shot = await capturer.captureWindow(win, args.scale)
              const procName = capturer.processNameOf(win.pid)
              const winValue = {
                title: win.title,
                processName: procName,
                pid: win.pid,
                width: shot.width,
                height: shot.height,
              }
              // transient：轻量自检模式 —— 截图 PNG 只存在于内存，base64 后直接
              // HTTP 调视觉模型（注册文件里配置的模型）。零落盘、零附件、零删除。
              if (args.transient === true) {
                let description = ''
                try {
                  description = await describeImageDirect(shot.png)
                } catch (e) {
                  throw new Error('capture_window (transient): ' + String(e && e.message || e).slice(0, 300))
                }
                if (!description) description = '（图片内容不可用：视觉模型返回为空）'
                return { window: winValue, description }
              }
              let ref
              try {
                ref = await attachments.saveImage({ data: shot.png, mediaType: 'image/png', name: 'capture-window.png' })
              } catch (e) {
                throw new Error('capture_window: image rejected by attachment service: ' + String(e && e.message || e))
              }
              return {
                window: winValue,
                image: {
                  attachmentId: ref.attachmentId,
                  mediaType: ref.mediaType,
                  bytes: ref.bytes,
                  width: ref.width,
                  height: ref.height,
                  ...(typeof ref.name === 'string' ? { name: ref.name } : {}),
                },
              }
            },
          })
        } catch (e) {
          console.error('[dsh-mxl-vision-assist] capture_window registration failed:', String(e && e.message || e))
        }
      }
    }

    // ---- 初始化 + 轮询（enabled 开关驱动声明状态；注册文件随工作区出现补齐）----
    let lastEnabled = state.enabled
    let lastWriteWs = null
    async function poll() {
      discoverWorkspace()
      await readRegistration()
      probeVisionModel().catch(() => {})
      // 启动时可能还没有会话/工作区，注册文件写不出去；等工作区出现后补齐。
      // 只对同一工作区尝试一次，避免反复重试刷日志。
      if (workspacePath && workspacePath !== lastWriteWs) {
        lastWriteWs = workspacePath
        await writeRegistration()
      }
      if (state.enabled !== lastEnabled) {
        lastEnabled = state.enabled
        if (state.enabled) await ensureDeclarations()
        else await restoreDeclarations()
      }
    }

    async function init() {
      try {
        discoverWorkspace()
        await readRegistration()
        lastEnabled = state.enabled
        lastWriteWs = workspacePath || null
        await writeRegistration()
        if (state.enabled) await ensureDeclarations()
      } catch (e) {
        console.error('[dsh-mxl-vision-assist] init error:', String(e && e.message || e))
      }
    }

    init()
    ctx.interval(poll, 200)
    ctx.effect(() => () => {
      restoreDeclarations()
    })
  },
}
