'use strict'

// MXL custom settings panel - host half (zero-dependency CJS module).
// Mounted at HOST level from profiles/web/cordis.patch.yml, so the panel
// exists in the web UI without any session, like the official settings
// sections. Consumes host services only (webServer/fs/sandboxPolicy).
// Bridge: a /mxl-panel prefix route the browser half polls (registry) and
// posts (write).

var PLUGIN_FILE_RE = /^\.dsh-plugin\.([a-z0-9-]{1,64})\.json$/
var PLUGIN_ID_RE = /^[a-z0-9-]{1,64}$/
var SCHEMA_TYPES = { select: true, switch: true, text: true, group: true }

function sanitizePlugin(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  if (typeof data.id !== 'string' || !PLUGIN_ID_RE.test(data.id)) return undefined
  var out = {
    id: data.id,
    name: typeof data.name === 'string' && data.name.length > 0 ? data.name : data.id,
    description: typeof data.description === 'string' ? data.description : '',
    enabled: data.enabled !== false,
    settings: (data.settings !== null && typeof data.settings === 'object' && !Array.isArray(data.settings)) ? Object.assign({}, data.settings) : {},
  }
  if (Array.isArray(data.schema)) {
    var schema = []
    for (var i = 0; i < data.schema.length; i++) {
      var field = data.schema[i]
      if (field === null || typeof field !== 'object' || typeof field.key !== 'string' || field.key.length === 0) continue
      var clean = { key: field.key, label: typeof field.label === 'string' ? field.label : field.key }
      clean.type = SCHEMA_TYPES[field.type] === true ? field.type : 'text'
      if (typeof field.toggle === 'string' && field.toggle.length > 0) clean.toggle = field.toggle
      if (field.indent === true) clean.indent = true
      if (clean.type === 'select' && Array.isArray(field.options)) {
        var options = []
        for (var j = 0; j < field.options.length; j++) {
          var o = field.options[j]
          if (o === null || typeof o !== 'object') continue
          options.push({ value: String(o.value !== undefined ? o.value : ''), label: typeof o.label === 'string' ? o.label : String(o.value !== undefined ? o.value : '') })
        }
        clean.options = options
      }
      schema.push(clean)
    }
    out.schema = schema
  } else {
    out.schema = []
  }
  return out
}

module.exports = {
  inject: ['webServer', 'fs', 'sandboxPolicy'],
  apply: function (ctx) {
    var web = ctx.webServer
    var fs = ctx.fs
    var sandboxPolicy = ctx.sandboxPolicy

    function sendJson(res, status, value) {
      var body = JSON.stringify(value)
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
      res.end(body)
    }

    function readBody(req) {
      return new Promise(function (resolve) {
        var chunks = []
        req.on('data', function (chunk) { chunks.push(chunk) })
        req.on('end', function () {
          try {
            var text = Buffer.concat(chunks).toString('utf8')
            resolve(text.length === 0 ? undefined : JSON.parse(text))
          } catch (err) {
            resolve(undefined)
          }
        })
      })
    }

    async function readRegistry(workspacePath) {
      var plugins = []
      var entries = []
      try {
        var target = await fs.resolve(workspacePath)
        entries = await fs.listDir(target)
      } catch (err) {
        return plugins
      }
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i]
        var name = String(entry !== null && typeof entry === 'object' && entry.name !== undefined ? entry.name : '')
        var match = PLUGIN_FILE_RE.exec(name)
        if (match === null) continue
        try {
          var fileTarget = await fs.resolve(workspacePath + '/' + name)
          var text = await fs.readText(fileTarget)
          var parsed = sanitizePlugin(JSON.parse(text))
          if (parsed !== undefined) plugins.push(parsed)
        } catch (err) {
          // skip registry files that cannot be parsed
        }
      }
      plugins.sort(function (a, b) { return a.name.localeCompare(b.name) })
      return plugins
    }

    var handler = async function (req, res) {
      var url = new URL(req.url !== undefined ? req.url : '/', 'http://x')
      var pathname = decodeURIComponent(url.pathname)
      try {
        if (pathname === '/mxl-panel/registry' && req.method === 'GET') {
          var rawPath = url.searchParams.get('path')
          var path = rawPath !== null ? rawPath : ''
          if (path.length === 0 || path.length > 512) return sendJson(res, 400, { ok: false, error: 'path invalid' })
          var plugins = await readRegistry(path)
          return sendJson(res, 200, { ok: true, plugins: plugins })
        }
        if (pathname === '/mxl-panel/write' && req.method === 'POST') {
          var body = await readBody(req)
          if (body === null || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'invalid body' })
          var filePath = typeof body.path === 'string' ? body.path : ''
          var fileId = typeof body.fileId === 'string' ? body.fileId : ''
          var patch = body.patch
          if (filePath.length === 0 || filePath.length > 512) return sendJson(res, 400, { ok: false, error: 'path invalid' })
          if (!PLUGIN_ID_RE.test(fileId)) return sendJson(res, 400, { ok: false, error: 'plugin id invalid' })
          if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return sendJson(res, 400, { ok: false, error: 'patch invalid' })
          var policy = sandboxPolicy === undefined
            ? { mode: 'workspace-write', workspaceRoot: filePath }
            : { mode: sandboxPolicy.defaultMode, workspaceRoot: filePath }
          try {
            var file = filePath + '/.dsh-plugin.' + fileId + '.json'
            var target = await fs.resolve(file)
            var text = await fs.readText(target)
            var data = JSON.parse(text)
            if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('registry file malformed')
            var next = Object.assign({}, data)
            if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
            if (patch.settings !== null && typeof patch.settings === 'object' && !Array.isArray(patch.settings)) {
              next.settings = Object.assign({}, (data.settings !== null && typeof data.settings === 'object' && !Array.isArray(data.settings)) ? data.settings : {}, patch.settings)
            }
            await fs.writeText(target, JSON.stringify(next, null, 2), undefined, undefined, policy)
            return sendJson(res, 200, { ok: true })
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: err !== null && typeof err === 'object' && typeof err.message === 'string' ? err.message : String(err) })
          }
        }
        res.writeHead(404)
        res.end()
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err !== null && typeof err === 'object' && typeof err.message === 'string' ? err.message : String(err) })
      }
    }

    ctx.effect(function () {
      return web.register({ kind: 'prefix', path: '/mxl-panel', handler: handler })
    }, 'mxl-custom-settings: /mxl-panel route')
  },
}
