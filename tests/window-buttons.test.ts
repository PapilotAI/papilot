import test from 'node:test';
import assert from 'node:assert/strict';
import { detectWindowButtons, gtkLayout, kwinLayout, windowButtonsArgument, xfwmLayout, WINDOW_BUTTONS_ARGUMENT } from '../desktop/window-buttons.ts';

test('GTK button layouts keep the desktop side, buttons and order', () => {
  assert.deepEqual(gtkLayout("'appmenu:close'\n"), { side: 'right', buttons: ['close'] }, 'GNOME default');
  assert.deepEqual(gtkLayout("'appmenu:minimize,maximize,close'"), { side: 'right', buttons: ['minimize', 'maximize', 'close'] });
  assert.deepEqual(gtkLayout("'close,minimize,maximize:'"), { side: 'left', buttons: ['close', 'minimize', 'maximize'] });
  assert.deepEqual(gtkLayout("'close:minimize,maximize'"), { side: 'left', buttons: ['close', 'minimize', 'maximize'] }, 'Split buttons gather on the side with close');
  assert.deepEqual(gtkLayout("'menu:minimize,maximize'"), { side: 'right', buttons: ['minimize', 'maximize'] });
  assert.equal(gtkLayout("'appmenu:'"), null, 'No buttons leaves the default');
  assert.equal(gtkLayout(''), null);
});

test('KDE and Xfce layouts map their button letters', () => {
  assert.deepEqual(kwinLayout(''), { side: 'right', buttons: ['minimize', 'maximize', 'close'] }, 'Plasma default');
  assert.deepEqual(kwinLayout('[Other]\nButtonsOnLeft=X\n[org.kde.kdecoration2]\nButtonsOnLeft=XIA\nButtonsOnRight=\nlibrary=org.kde.breeze\n'), { side: 'left', buttons: ['close', 'minimize', 'maximize'] });
  assert.deepEqual(xfwmLayout('O|HMC\n'), { side: 'right', buttons: ['minimize', 'maximize', 'close'] }, 'Xfce default');
  assert.deepEqual(xfwmLayout('CHM|O'), { side: 'left', buttons: ['close', 'minimize', 'maximize'] });
});

test('detection reads the layout from the current desktop', async () => {
  const calls: string[][] = [];
  const exec = async (command: string, args: string[]) => { calls.push([command, ...args]); return command === 'xfconf-query' ? 'CMH|O' : "'close,minimize:'"; };
  assert.deepEqual(await detectWindowButtons({ env: { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }, exec }), { side: 'left', buttons: ['close', 'minimize'] });
  assert.deepEqual(calls.at(-1), ['gsettings', 'get', 'org.gnome.desktop.wm.preferences', 'button-layout']);
  await detectWindowButtons({ env: { XDG_CURRENT_DESKTOP: 'X-Cinnamon' }, exec });
  assert.equal(calls.at(-1)?.[2], 'org.cinnamon.desktop.wm.preferences');
  await detectWindowButtons({ env: { XDG_CURRENT_DESKTOP: 'MATE' }, exec });
  assert.equal(calls.at(-1)?.[2], 'org.mate.Marco.general');
  assert.deepEqual(await detectWindowButtons({ env: { XDG_CURRENT_DESKTOP: 'XFCE' }, exec }), { side: 'left', buttons: ['close', 'maximize', 'minimize'] });
  const read = async (file: string) => { assert.equal(file, '/config/kwinrc'); return '[org.kde.kdecoration2]\nButtonsOnRight=X\n'; };
  assert.deepEqual(await detectWindowButtons({ env: { XDG_CURRENT_DESKTOP: 'KDE', XDG_CONFIG_HOME: '/config' }, exec, read }), { side: 'right', buttons: ['close'] });
  assert.equal(await detectWindowButtons({ env: {}, exec: async () => { throw Error('no gsettings'); } }), null, 'Unknown layouts fall back to the page default');
});

test('the layout reaches the preload as one JSON argument', () => {
  const argument = windowButtonsArgument({ side: 'right', buttons: ['close'] });
  assert.ok(argument.startsWith(WINDOW_BUTTONS_ARGUMENT));
  assert.deepEqual(JSON.parse(argument.slice(WINDOW_BUTTONS_ARGUMENT.length)), { side: 'right', buttons: ['close'] });
});
