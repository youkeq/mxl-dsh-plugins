;(function () {
  'use strict'
  window.__ModuleLoader__.load({
    id: 'dsh-mxl-custom-settings',
    factory: function (require) {
      var React = require('react')
      var h = React.createElement
      var exports = {}

      exports.inject = ['slots']

      exports.apply = function (ctx) {
        var slots = ctx.get('slots')
        if (slots === undefined) {
          console.error('[dsh-mxl-custom-settings] slots service unavailable')
          return
        }

        var CSS = [
          '.mxl-panel{display:flex;flex-direction:column;gap:12px;padding:2px 0 24px}',
          '.mxl-note{color:var(--dsw-alias-state-error-primary,#c0392b);font-size:12px;line-height:18px}',
          '.mxl-empty{color:var(--dsw-alias-label-secondary,#666);font-size:13px;line-height:20px;padding:8px 2px}',
          '.mxl-card{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,#e3e7ee);border-radius:12px;padding:14px 16px}',
          '.mxl-card-head{display:flex;align-items:center;gap:12px}',
          '.mxl-expand{flex:none;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#555);font-size:15px;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center}',
          '.mxl-expand:hover{background:var(--dsw-alias-interactive-bg-hover,transparent)}',
          '.mxl-name{flex:1;min-width:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
          '.mxl-desc{font-size:12px;color:var(--dsw-alias-label-secondary,#666);line-height:18px;margin-top:4px}',
          '.mxl-sw{flex:none;position:relative;width:48px;height:28px;border:none;border-radius:999px;cursor:pointer;background:var(--dsw-alias-border-l2,#c9cfda);padding:0;transition:background .15s;box-shadow:inset 0 1px 2px rgba(0,0,0,.15)}',
          '.mxl-sw-on{background:var(--dsw-alias-state-business-primary,#3964fe)}',
          '.mxl-knob{position:absolute;top:4px;left:4px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .15s}',
          '.mxl-sw-on .mxl-knob{left:24px}',
          '.mxl-fields{margin-top:10px;border-top:1px dashed var(--dsw-alias-border-l1,#e3e7ee);padding-top:10px;display:flex;flex-direction:column;gap:10px}',
          '.mxl-row{display:flex;align-items:center;justify-content:space-between;gap:12px}',
          '.mxl-indent{margin-left:16px}',
          '.mxl-label{font-size:13px;color:var(--dsw-alias-label-primary,#1a1a1a);line-height:20px}',
          '.mxl-group{font-weight:600}',
          '.mxl-input{flex:1;min-width:0;height:36px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l2,#c9cfda);border-radius:10px;background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-size:14px;outline:none;box-sizing:border-box}',
          '.mxl-input:focus{border-color:var(--dsw-alias-state-business-primary,#3964fe)}',
          '.mxl-select{flex:1;min-width:0;height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#c9cfda);border-radius:10px;background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-size:14px;outline:none}',
        ].join('\n')

        var styleEl = null
        ctx.effect(function () {
          styleEl = document.createElement('style')
          styleEl.setAttribute('data-plugin', 'dsh-mxl-custom-settings')
          styleEl.textContent = CSS
          document.head.appendChild(styleEl)
          return function () {
            if (styleEl !== null && styleEl.parentNode !== null) styleEl.parentNode.removeChild(styleEl)
            styleEl = null
          }
        }, 'dsh-mxl-custom-settings: panel css')

        // Plugin bus: future plugins may subscribe to panel changes.
        var busListeners = []
        var bus = {
          subscribe: function (fn) {
            if (typeof fn !== 'function') return function () {}
            busListeners.push(fn)
            return function () {
              var i = busListeners.indexOf(fn)
              if (i >= 0) busListeners.splice(i, 1)
            }
          },
          notify: function (payload) {
            for (var i = 0; i < busListeners.length; i++) {
              try { busListeners[i](payload) } catch (err) { console.error('[dsh-mxl-custom-settings] bus listener failed', err) }
            }
          },
        }
        ctx.provide('customPluginBus', bus)

        function cwdSelector(state) {
          if (state === null || state === undefined || state.current === undefined) return null
          var row = state.byId !== null && typeof state.byId === 'object' ? state.byId[state.current] : undefined
          return row !== undefined && typeof row.cwd === 'string' ? row.cwd : null
        }

        function Switch(props) {
          var on = props.on === true
          return h('button', {
            type: 'button',
            className: on ? 'mxl-sw mxl-sw-on' : 'mxl-sw',
            title: props.title !== undefined ? props.title : undefined,
            onClick: function () { if (typeof props.onToggle === 'function') props.onToggle(!on) },
          }, h('span', { className: 'mxl-knob' }))
        }

        function TextField(props) {
          var draft = React.useRef(null)
          return h('div', { className: props.indent === true ? 'mxl-row mxl-indent' : 'mxl-row' },
            h('span', { className: 'mxl-label' }, props.label),
            h('input', {
              className: 'mxl-input',
              type: 'text',
              defaultValue: typeof props.value === 'string' ? props.value : '',
              ref: draft,
              onBlur: function () {
                var next = draft.current !== null ? String(draft.current.value) : ''
                if (typeof props.onChange === 'function') props.onChange(next)
              },
              onKeyDown: function (e) {
                if (e.key === 'Enter' && typeof props.onChange === 'function') {
                  var next = draft.current !== null ? String(draft.current.value) : ''
                  props.onChange(next)
                }
              },
            }))
        }

        function SelectField(props) {
          var options = Array.isArray(props.options) ? props.options : []
          return h('div', { className: props.indent === true ? 'mxl-row mxl-indent' : 'mxl-row' },
            h('span', { className: 'mxl-label' }, props.label),
            h('select', {
              className: 'mxl-select',
              value: typeof props.value === 'string' ? props.value : '',
              onChange: function (e) { if (typeof props.onChange === 'function') props.onChange(String(e.target.value)) },
            },
              options.map(function (o) {
                var v = o !== null && typeof o === 'object' ? String(o.value !== undefined ? o.value : '') : String(o)
                var l = o !== null && typeof o === 'object' && typeof o.label === 'string' ? o.label : v
                return h('option', { key: v, value: v }, l)
              })))
        }

        function PluginCard(props) {
          var plugin = props.plugin
          var settings = plugin.settings !== null && typeof plugin.settings === 'object' ? plugin.settings : {}
          var schema = Array.isArray(plugin.schema) ? plugin.schema : []
          var isOpen = props.expanded === true
          var fields = []
          for (var i = 0; i < schema.length; i++) {
            var field = schema[i]
            if (field === null || typeof field !== 'object') continue
            var key = field.key
            if (typeof key !== 'string' || key.length === 0) continue
            var label = typeof field.label === 'string' ? field.label : key
            var indent = field.indent === true
            if (field.type === 'group') {
              var toggleKey = typeof field.toggle === 'string' ? field.toggle : null
              fields.push(h('div', { key: key, className: 'mxl-row' },
                h('span', { className: 'mxl-label mxl-group' }, label),
                toggleKey === null ? null : h(Switch, {
                  on: settings[toggleKey] === true,
                  onToggle: function (next) { props.changeSetting(toggleKey, next) },
                })))
            } else if (field.type === 'switch') {
              fields.push(h('div', { key: key, className: indent ? 'mxl-row mxl-indent' : 'mxl-row' },
                h('span', { className: 'mxl-label' }, label),
                h(Switch, {
                  on: settings[key] === true,
                  onToggle: function (next) { props.changeSetting(key, next) },
                })))
            } else if (field.type === 'select') {
              fields.push(h(SelectField, {
                key: key, label: label, indent: indent,
                value: settings[key], options: field.options,
                onChange: function (next) { props.changeSetting(key, next) },
              }))
            } else {
              fields.push(h(TextField, {
                key: key, label: label, indent: indent,
                value: settings[key],
                onChange: function (next) { props.changeSetting(key, next) },
              }))
            }
          }
          return h('div', { className: 'mxl-card' },
            h('div', { className: 'mxl-card-head' },
              h('button', {
                type: 'button',
                className: 'mxl-expand',
                onClick: function () { props.toggleExpanded() },
              }, isOpen ? String.fromCharCode(0x25be) : String.fromCharCode(0x25b8)),
              h('div', { className: 'mxl-name' }, plugin.name),
              h(Switch, {
                on: plugin.enabled === true,
                title: plugin.enabled === true ? '已启用' : '已停用',
                onToggle: function (next) { props.setEnabled(next) },
              })),
            typeof plugin.description === 'string' && plugin.description.length > 0
              ? h('div', { className: 'mxl-desc' }, plugin.description)
              : null,
            isOpen ? h('div', { className: 'mxl-fields' }, fields) : null)
        }

        function Panel(props) {
          var cwd = typeof props.useSessions === 'function' ? props.useSessions(cwdSelector) : null
          var s1 = React.useState([]); var plugins = s1[0]; var setPlugins = s1[1]
          var s2 = React.useState({}); var expanded = s2[0]; var setExpanded = s2[1]
          var s3 = React.useState(null); var notice = s3[0]; var setNotice = s3[1]
          var refreshRef = React.useRef(function () {})

          React.useEffect(function () {
            var cancelled = false
            function refresh() {
              if (typeof cwd !== 'string' || cwd.length === 0) {
                if (!cancelled) { setPlugins([]); setNotice('尚未打开会话；打开会话后这里会列出该工作区的自定义插件。') }
                return
              }
              fetch('/mxl-panel/registry?path=' + encodeURIComponent(cwd), { credentials: 'same-origin' })
                .then(function (r) { return r.json() })
                .then(function (data) {
                  if (cancelled) return
                  if (data !== null && typeof data === 'object' && data.ok === true && Array.isArray(data.plugins)) {
                    setPlugins(data.plugins)
                    setNotice(null)
                  } else {
                    var reason = data !== null && typeof data === 'object' && typeof data.error === 'string' ? data.error : '未知错误'
                    setNotice('读取插件失败：' + reason)
                  }
                })
                .catch(function (err) {
                  if (cancelled) return
                  setNotice('读取插件失败：' + (err !== null && typeof err === 'object' && typeof err.message === 'string' ? err.message : String(err)))
                })
            }
            refreshRef.current = refresh
            refresh()
            var timer = window.setInterval(refresh, 3000)
            return function () { cancelled = true; window.clearInterval(timer) }
          }, [cwd])

          function write(fileId, patch) {
            if (typeof cwd !== 'string' || cwd.length === 0) return
            fetch('/mxl-panel/write', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ path: cwd, fileId: fileId, patch: patch }),
            }).then(function (r) { return r.json() })
              .then(function (data) {
                if (data !== null && typeof data === 'object' && data.ok === true) {
                  refreshRef.current()
                } else {
                  var reason = data !== null && typeof data === 'object' && typeof data.error === 'string' ? data.error : '未知错误'
                  setNotice('保存失败：' + reason)
                }
              })
              .catch(function (err) {
                setNotice('保存失败：' + (err !== null && typeof err === 'object' && typeof err.message === 'string' ? err.message : String(err)))
              })
          }

          var cards = plugins.map(function (plugin) {
            return h(PluginCard, {
              key: plugin.id,
              plugin: plugin,
              expanded: expanded[plugin.id] === true,
              toggleExpanded: function () {
                var next = Object.assign({}, expanded)
                if (next[plugin.id] === true) delete next[plugin.id]; else next[plugin.id] = true
                setExpanded(next)
              },
              setEnabled: function (next) { write(plugin.id, { enabled: next === true }) },
              changeSetting: function (key, value) {
                var patch = {}
                patch[key] = value
                write(plugin.id, { settings: patch })
              },
            })
          })

          return h('div', { className: 'mxl-panel' },
            notice !== null ? h('div', { className: 'mxl-note' }, notice) : null,
            cards.length === 0 && notice === null
              ? h('div', { className: 'mxl-empty' }, '此工作区还没有自定义插件。将插件的注册文件（.dsh-plugin.<id>.json）放入工作区根目录后，它会自动出现在这里。')
              : null,
            cards)
        }

        slots.inject('settings.section', function () {
          return slots.register({ name: 'settings.section', id: 'custom-settings', order: 9999, label: '自定义设置' }, Panel)
        })
      }

      return exports
    },
  })
})()
