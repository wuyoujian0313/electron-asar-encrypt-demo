require('./asar.js')
const { app, BrowserWindow, nativeImage, ipcMain } = require('electron')
const { format } = require('url')
const { join } = require('path')
const { existsSync } = require('fs')

for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i].indexOf('--inspect') !== -1 || process.argv[i].indexOf('--remote-debugging-port') !== -1) {
    throw new Error('Not allow debugging this program.')
  }
}

console.log(require('outerpkg'))

function isPromiseLike (obj) {
  return (obj instanceof Promise) || (
    obj !== undefined && obj !== null && typeof obj.then === 'function' && typeof obj.catch === 'function'
  )
}

class WindowManager {
  constructor () {
    if (WindowManager._instance) {
      throw new Error('Can not create multiple WindowManager instances.')
    }
    this.windows = new Map()
  }

  createWindow (name, browerWindowOptions, url, entry) {
    if (this.windows.has(name)) {
      throw new Error(`The window named "${name}" exists.`)
    }

    if (!('icon' in browerWindowOptions)) {
      if (process.platform === 'linux') {
        const linuxIcon = join(__dirname, '../../icon/app.png')
        if (existsSync(linuxIcon)) {
          browerWindowOptions.icon = nativeImage.createFromPath(linuxIcon)
        }
      } else {
        if (process.env.NODE_ENV !== 'production') {
          const iconPath = join(__dirname, `../../../icon/app.${process.platform === 'win32' ? 'ico' : 'icns'}`)
          if (existsSync(iconPath)) {
            browerWindowOptions.icon = nativeImage.createFromPath(iconPath)
          }
        }
      }
    }

    let win = new BrowserWindow(browerWindowOptions)
    win.webContents.executeJavaScript(`!function () {
      const crypto = require('crypto')
      const Module = require('module')
      const dialog = require('electron').remote.dialog

      const key = Buffer.from([${WindowManager.__SECRET_KEY__.join(',')}])

      function decrypt (body) {
        const iv = body.slice(0, 16)
        const data = body.slice(16)
        const clearEncoding = 'utf8'
        const cipherEncoding = 'binary'
        const chunks = []
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
        decipher.setAutoPadding(true)
        chunks.push(decipher.update(data, cipherEncoding, clearEncoding))
        chunks.push(decipher.final(clearEncoding))
        const code = chunks.join('')
        return code
      }
      
      const oldCompile = Module.prototype._compile
      
      Module.prototype._compile = function (content, filename) {
        if (filename.indexOf('app.asar') !== -1) {
          return oldCompile.call(this, decrypt(Buffer.from(content, 'base64')), filename)
        }
        return oldCompile.call(this, content, filename)
      }

      require('./asar.js')
      require('${entry}')
    }()`)

    win.on('ready-to-show', function () {
      if (!win) return
      win.show()
      win.focus()
      if (process.env.NODE_ENV !== 'production') win.webContents.openDevTools()
    })

    win.on('closed', () => {
      win = null
      this.windows.delete(name)
    })

    this.windows.set(name, win)

    win.removeMenu ? win.removeMenu() : win.setMenu(null)

    const res = win.loadURL(url)

    if (isPromiseLike(res)) {
      res.catch((err) => {
        console.log(err)
      })
    }
  }

  getWindow (name) {
    if (this.windows.has(name)) {
      return this.windows.get(name)
    }
    throw new Error(`The window named "${name} doesn't exists."`)
  }

  removeWindow (name) {
    if (!this.windows.has(name)) {
      throw new Error(`The window named "${name} doesn't exists."`)
    }
    this.windows.get(name).close()
  }

  hasWindow (name) {
    return this.windows.has(name)
  }
}

WindowManager.getInstance = function () {
  if (!WindowManager._instance) {
    WindowManager._instance = new WindowManager()
  }
  return WindowManager._instance
}

WindowManager.ID_MAIN_WINDOW = 'main-window'

WindowManager.__SECRET_KEY__ = []

WindowManager.createMainWindow = function () {
  const windowManager = WindowManager.getInstance()
  if (!windowManager.hasWindow(WindowManager.ID_MAIN_WINDOW)) {
    const browerWindowOptions = {
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        devTools: false
      }
    }

    windowManager.createWindow(
      WindowManager.ID_MAIN_WINDOW,
      browerWindowOptions,
      format({
        pathname: join(__dirname, './index.html'),
        protocol: 'file:',
        slashes: true
      }),
      './renderer/renderer.js'
    )
  }
}

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', function () {
  WindowManager.createMainWindow()
})

function mustNotExportKey (key) {
  // ipcMain.on('getkey', (e) => {
  //   e.returnValue = []
  // })
  ipcMain.on('check', (e, arr) => {
    if (arr.length !== key.length) {
      e.returnValue = {
        err: null,
        data: false
      }
      return
    }
    for (let i = 0; i < key.length; i++) {
      try {
        if (key[i] !== arr[i]) {
          e.returnValue = {
            err: null,
            data: false
          }
          return
        }
      } catch (e) {
        e.returnValue = {
          err: e.message,
          data: false
        }
        return
      }
    }
    e.returnValue = {
      err: null,
      data: true
    }
  })
}

function main () {
  WindowManager.createMainWindow()
}

module.exports = function bootstrap (k) {
  if (!Array.isArray(k) || k.length === 0) {
    throw new Error('Failed to bootstrap application.')
  }
  WindowManager.__SECRET_KEY__ = k
  mustNotExportKey(k)
  if (app.whenReady === 'function') {
    app.whenReady().then(main).catch(err => console.log(err))
  } else {
    app.on('ready', main)
  }
}
