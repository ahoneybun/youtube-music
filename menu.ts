import { existsSync } from 'node:fs';
import path from 'node:path';

import is from 'electron-is';
import { app, BrowserWindow, clipboard, dialog, Menu } from 'electron';
import prompt from 'custom-electron-prompt';

import { restart } from './providers/app-controls';
import { getAllPlugins } from './plugins/utils';
import config from './config';
import { startingPages } from './providers/extracted-data';
import promptOptions from './providers/prompt-options';

export type MenuTemplate = (Electron.MenuItemConstructorOptions | Electron.MenuItem)[];

// True only if in-app-menu was loaded on launch
const inAppMenuActive = config.plugins.isEnabled('in-app-menu');

const betaPlugins = ['crossfade', 'lumiastream'];

const pluginEnabledMenu = (plugin: string, label = '', hasSubmenu = false, refreshMenu: (() => void ) | undefined = undefined): Electron.MenuItemConstructorOptions => ({
  label: label || plugin,
  type: 'checkbox',
  checked: config.plugins.isEnabled(plugin),
  click(item: Electron.MenuItem) {
    if (item.checked) {
      config.plugins.enable(plugin);
    } else {
      config.plugins.disable(plugin);
    }

    if (hasSubmenu) {
      refreshMenu?.();
    }
  },
});

export const mainMenuTemplate = (win: BrowserWindow): MenuTemplate => {
  const refreshMenu = () => {
    setApplicationMenu(win);
    if (inAppMenuActive) {
      win.webContents.send('refreshMenu');
    }
  };

  return [
    {
      label: 'Plugins',
      submenu:
        getAllPlugins().map((plugin) => {
          let pluginLabel = plugin;
          if (betaPlugins.includes(plugin)) {
            pluginLabel += ' [beta]';
          }

          const pluginPath = path.join(__dirname, 'plugins', plugin, 'menu.js');
          if (existsSync(pluginPath)) {
            if (!config.plugins.isEnabled(plugin)) {
              return pluginEnabledMenu(plugin, pluginLabel, true, refreshMenu);
            }

            type PluginType = (window: BrowserWindow, plugins: string, func: () => void) => Electron.MenuItemConstructorOptions[];

            // eslint-disable-next-line @typescript-eslint/no-var-requires,@typescript-eslint/no-unsafe-member-access
            const getPluginMenu = require(pluginPath).default as PluginType;
            return {
              label: pluginLabel,
              submenu: [
                pluginEnabledMenu(plugin, 'Enabled', true, refreshMenu),
                { type: 'separator' },
                ...getPluginMenu(win, config.plugins.getOptions(plugin), refreshMenu),
              ],
            } satisfies Electron.MenuItemConstructorOptions;
          }

          return pluginEnabledMenu(plugin, pluginLabel);
        }),
    },
    {
      label: 'Options',
      submenu: [
        {
          label: 'Auto-update',
          type: 'checkbox',
          checked: config.get('options.autoUpdates'),
          click(item) {
            config.setMenuOption('options.autoUpdates', item.checked);
          },
        },
        {
          label: 'Resume last song when app starts',
          type: 'checkbox',
          checked: config.get('options.resumeOnStart'),
          click(item) {
            config.setMenuOption('options.resumeOnStart', item.checked);
          },
        },
        {
          label: 'Starting page',
          submenu: Object.keys(startingPages).map((name) => ({
            label: name,
            type: 'radio',
            checked: config.get('options.startingPage') === name,
            click() {
              config.set('options.startingPage', name);
            },
          })),
        },
        {
          label: 'Visual Tweaks',
          submenu: [
            {
              label: 'Remove upgrade button',
              type: 'checkbox',
              checked: config.get('options.removeUpgradeButton'),
              click(item) {
                config.setMenuOption('options.removeUpgradeButton', item.checked);
              },
            },
            {
              label: 'Like buttons',
              submenu: [
                {
                  label: 'Default',
                  type: 'radio',
                  checked: !config.get('options.likeButtons'),
                  click() {
                    config.set('options.likeButtons', '');
                  },
                },
                {
                  label: 'Force show',
                  type: 'radio',
                  checked: config.get('options.likeButtons') === 'force',
                  click() {
                    config.set('options.likeButtons', 'force');
                  },
                },
                {
                  label: 'Hide',
                  type: 'radio',
                  checked: config.get('options.likeButtons') === 'hide',
                  click() {
                    config.set('options.likeButtons', 'hide');
                  },
                },
              ],
            },
            {
              label: 'Theme',
              submenu: [
                {
                  label: 'No theme',
                  type: 'radio',
                  checked: !config.get('options.themes'), // Todo rename "themes"
                  click() {
                    config.set('options.themes', []);
                  },
                },
                { type: 'separator' },
                {
                  label: 'Import custom CSS file',
                  type: 'radio',
                  checked: false,
                  async click() {
                    const { filePaths } = await dialog.showOpenDialog({
                      filters: [{ name: 'CSS Files', extensions: ['css'] }],
                      properties: ['openFile', 'multiSelections'],
                    });
                    if (filePaths) {
                      config.set('options.themes', filePaths);
                    }
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Single instance lock',
          type: 'checkbox',
          checked: true,
          click(item) {
            if (!item.checked && app.hasSingleInstanceLock()) {
              app.releaseSingleInstanceLock();
            } else if (item.checked && !app.hasSingleInstanceLock()) {
              app.requestSingleInstanceLock();
            }
          },
        },
        {
          label: 'Always on top',
          type: 'checkbox',
          checked: config.get('options.alwaysOnTop'),
          click(item) {
            config.setMenuOption('options.alwaysOnTop', item.checked);
            win.setAlwaysOnTop(item.checked);
          },
        },
        ...(is.windows() || is.linux()
          ? [
            {
              label: 'Hide menu',
              type: 'checkbox',
              checked: config.get('options.hideMenu'),
              click(item) {
                config.setMenuOption('options.hideMenu', item.checked);
                if (item.checked && !config.get('options.hideMenuWarned')) {
                  dialog.showMessageBox(win, {
                    type: 'info', title: 'Hide Menu Enabled',
                    message: 'Menu will be hidden on next launch, use [Alt] to show it (or backtick [`] if using in-app-menu)',
                  });
                }
              },
            },
          ]
          : []) satisfies Electron.MenuItemConstructorOptions[],
        ...(is.windows() || is.macOS()
          ? // Only works on Win/Mac
          // https://www.electronjs.org/docs/api/app#appsetloginitemsettingssettings-macos-windows
          [
            {
              label: 'Start at login',
              type: 'checkbox',
              checked: config.get('options.startAtLogin'),
              click(item) {
                config.setMenuOption('options.startAtLogin', item.checked);
              },
            },
          ]
          : []) satisfies Electron.MenuItemConstructorOptions[],
        {
          label: 'Tray',
          submenu: [
            {
              label: 'Disabled',
              type: 'radio',
              checked: !config.get('options.tray'),
              click() {
                config.setMenuOption('options.tray', false);
                config.setMenuOption('options.appVisible', true);
              },
            },
            {
              label: 'Enabled + app visible',
              type: 'radio',
              checked: config.get('options.tray') && config.get('options.appVisible'),
              click() {
                config.setMenuOption('options.tray', true);
                config.setMenuOption('options.appVisible', true);
              },
            },
            {
              label: 'Enabled + app hidden',
              type: 'radio',
              checked: config.get('options.tray') && !config.get('options.appVisible'),
              click() {
                config.setMenuOption('options.tray', true);
                config.setMenuOption('options.appVisible', false);
              },
            },
            { type: 'separator' },
            {
              label: 'Play/Pause on click',
              type: 'checkbox',
              checked: config.get('options.trayClickPlayPause'),
              click(item) {
                config.setMenuOption('options.trayClickPlayPause', item.checked);
              },
            },
          ],
        },
        { type: 'separator' },
        {
          label: 'Advanced options',
          submenu: [
            {
              label: 'Proxy',
              type: 'checkbox',
              checked: !!(config.get('options.proxy')),
              click(item) {
                setProxy(item, win);
              },
            },
            {
              label: 'Override useragent',
              type: 'checkbox',
              checked: config.get('options.overrideUserAgent'),
              click(item) {
                config.setMenuOption('options.overrideUserAgent', item.checked);
              },
            },
            {
              label: 'Disable hardware acceleration',
              type: 'checkbox',
              checked: config.get('options.disableHardwareAcceleration'),
              click(item) {
                config.setMenuOption('options.disableHardwareAcceleration', item.checked);
              },
            },
            {
              label: 'Restart on config changes',
              type: 'checkbox',
              checked: config.get('options.restartOnConfigChanges'),
              click(item) {
                config.setMenuOption('options.restartOnConfigChanges', item.checked);
              },
            },
            {
              label: 'Reset App cache when app starts',
              type: 'checkbox',
              checked: config.get('options.autoResetAppCache'),
              click(item) {
                config.setMenuOption('options.autoResetAppCache', item.checked);
              },
            },
            { type: 'separator' },
            is.macOS()
              ? {
                label: 'Toggle DevTools',
                // Cannot use "toggleDevTools" role in macOS
                click() {
                  const { webContents } = win;
                  if (webContents.isDevToolsOpened()) {
                    webContents.closeDevTools();
                  } else {
                    webContents.openDevTools();
                  }
                },
              }
              : { role: 'toggleDevTools' },
            {
              label: 'Edit config.json',
              click() {
                config.edit();
              },
            },
          ],
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Navigation',
      submenu: [
        {
          label: 'Go back',
          click() {
            if (win.webContents.canGoBack()) {
              win.webContents.goBack();
            }
          },
        },
        {
          label: 'Go forward',
          click() {
            if (win.webContents.canGoForward()) {
              win.webContents.goForward();
            }
          },
        },
        {
          label: 'Copy current URL',
          click() {
            const currentURL = win.webContents.getURL();
            clipboard.writeText(currentURL);
          },
        },
        {
          label: 'Restart App',
          click: restart,
        },
        { role: 'quit' },
      ],
    },
  ];
};
export const setApplicationMenu = (win: Electron.BrowserWindow) => {
  const menuTemplate: MenuTemplate = [...mainMenuTemplate(win)];
  if (process.platform === 'darwin') {
    const { name } = app;
    menuTemplate.unshift({
      label: name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'selectAll' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'close' },
        { role: 'quit' },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
};

async function setProxy(item: Electron.MenuItem, win: BrowserWindow) {
  const output = await prompt({
    title: 'Set Proxy',
    label: 'Enter Proxy Address: (leave empty to disable)',
    value: config.get('options.proxy'),
    type: 'input',
    inputAttrs: {
      type: 'url',
      placeholder: "Example: 'socks5://127.0.0.1:9999",
    },
    width: 450,
    ...promptOptions(),
  }, win);

  if (typeof output === 'string') {
    config.setMenuOption('options.proxy', output);
    item.checked = output !== '';
  } else { // User pressed cancel
    item.checked = !item.checked; // Reset checkbox
  }
}
