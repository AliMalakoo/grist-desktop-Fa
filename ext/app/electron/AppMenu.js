const electron   = require('electron');
const events     = require('events');
const path       = require('path');

const isMac      = process.platform === 'darwin';
// const isWin   = process.platform === 'win32';

const useUpdate  = process.env.GRIST_DESKTOP_USE_UPDATE === 'true';

const app        = electron.app;
const appName    = electron.app.getName();

class AppMenu extends events.EventEmitter {
  constructor(recentItems) {
    super();
    this.recentItems = recentItems;
    this._updateState = 'idle';
    this._menu = null;
    this.rebuildMenu();
  }

  addRecentItem(entry) {
    this.recentItems.addItem(entry);
  }

  getMenu() { return this._menu; }

  rebuildMenu() {
    const isActive = electron.Menu.getApplicationMenu() === this.getMenu();
    this._menu = electron.Menu.buildFromTemplate(this.buildTemplate());
    // TODO: Electron does not yet support updating the menu except by reassigning the entire
    // menu.  There are proposals to allow menu templates include callbacks that
    // are called on menu open. https://github.com/electron/electron/issues/528
    if (isActive) {
      this.setAsCurrentElectronMenu();
    }
  }

  setAsCurrentElectronMenu() {
    electron.Menu.setApplicationMenu(this.getMenu());
  }

  buildOpenRecentSubmenu() {
    let subMenu = [];
    this.recentItems.listItems().reverse().forEach(filePath => {
       subMenu.push({
          label: path.basename(filePath),
          click: () => app.emit('open-file', undefined, filePath)
       });
    });
    return subMenu;
  }

  buildTemplate() {
    let menuTemplate = [];

    if (isMac) {
      menuTemplate.push({
        label: appName,
        submenu: [
          { role: 'about' },
          // On Mac, the "Check for Updates" item goes into the leftmost "Grist" menu.
          ...(useUpdate ? this.buildUpdateItemsTemplate() : []),

          { type: 'separator' },
          { role: 'services', },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideothers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit', label: 'خروج' }
      ]});
    }

    menuTemplate.push({
      label: 'پرونده',
      submenu: [{
        label: 'جدید',
        accelerator: 'CmdOrCtrl+N',
        click: (item, focusedWindow) => this.emit('menu-file-new', focusedWindow)
      }, {
        label: 'باز کردن...',
        accelerator: 'CmdOrCtrl+O',
        click: (item, focusedWindow) => this.emit('menu-file-open', focusedWindow)
      }, {
        label: 'پرونده‌های اخیر',
        submenu: this.buildOpenRecentSubmenu()
      }, {
        role: 'close', label: 'بستن پنجره'
      }]
      .concat(!isMac ? [
        { type: 'separator' },
        { role: 'quit', label: 'خروج' }
      ] : [])
    }, {
      label: 'ویرایش',
      submenu: [{
        label: 'واگرد',
        accelerator: 'CmdOrCtrl+Z',
        // Not setting role because we're firing a custom action in click
        click: (item, win) => win.webContents.executeJavaScript('gristApp.allCommands.undo.run()')
      }, {
        label: 'بازانجام',
        accelerator: 'Shift+CmdOrCtrl+Z',
        // Not setting role because we're firing a custom action in click
        click: (item, win) => win.webContents.executeJavaScript('gristApp.allCommands.redo.run()')
      },
      { type: 'separator' },
      { role: 'cut', label: 'برش' },
      { role: 'copy', label: 'رونوشت' },
      { role: 'paste', label: 'چسباندن' },
      { role: 'selectall', label: 'انتخاب همه' } ]
    }, {
      label: 'نمایش',
      submenu: [{
        role: 'togglefullscreen', label: 'تمام‌صفحه'
      }, {
        label: 'ابزارهای توسعه‌دهنده',
        accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
        click: function (item, focusedWindow) {
          if (focusedWindow) {
            focusedWindow.toggleDevTools();
          }
        }
      }]
    }, {
      role: 'window', label: 'پنجره',
      submenu: [{
        role: 'minimize', label: 'کمینه کردن'
      }]
      .concat(isMac ? [
        { type: 'separator' },
        { role: 'front' }
      ] : [])
    }, {
      label: 'راهنما',
      role: 'help',
      submenu: (
        // On Windows, the "Check for Updates" item goes in the rightmost Help menu.
        ((useUpdate && !isMac) ? [ ...this.buildUpdateItemsTemplate(), { type: 'separator' }] : [])
        .concat({
          label: 'راهنمای Grist',
          click: (item, win) => win.webContents.executeJavaScript('gristApp.allCommands.help.run()')
        })
      )
    });

    return menuTemplate;
  }

  /**
   * Calls cb(item) for each menu item, including all submenus.
   */
  static forEachMenuItem(menu, cb) {
    for (let item of menu.items) {
      cb(item);
      if (item.submenu) {
        this.forEachMenuItem(item.submenu, cb);
      }
    }
  }

  /**
   * Given a build menu, and an auto-update state of 'idle', 'checking', 'downloading', or
   * 'restart', disables an appropriate item, and hides the rest. If optSuffix is set, it gets
   * appended to the label.
   */
  setUpdateState(state) {
    this._updateState = state;
    const labelToState = {
      'بررسی به‌روزرسانی':          'idle',
      'در حال بررسی به‌روزرسانی...':    'checking',
      'در حال دریافت به‌روزرسانی...':      'downloading',
      'راه‌اندازی دوباره برای به‌روزرسانی':         'relaunch',
    };
    AppMenu.forEachMenuItem(this._menu, item => {
      let labelState = labelToState[item.label];
      if (labelState) {
        item.visible = (state === labelState);
      }
    });
  }

  buildUpdateItemsTemplate() {
    return [
      { visible: true,  label: 'بررسی به‌روزرسانی', click: () => this.emit('check-for-updates') },
      { visible: false, label: 'در حال بررسی به‌روزرسانی...', enabled: false },
      { visible: false, label: 'در حال دریافت به‌روزرسانی...', enabled: false },
      { visible: false, label: 'راه‌اندازی دوباره برای به‌روزرسانی', click: () => this.emit('quit-and-install') },
    ];
  }
}

module.exports = AppMenu;
