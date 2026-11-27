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
  const kwinrc: Record<string, string> = {
    '/etc/xdg/kwinrc': '[org.kde.kdecoration2]\nButtonsOnLeft=X\nButtonsOnRight=IA\n',
    '/vendor/kwinrc': '[org.kde.kdecoration2]\nButtonsOnLeft=XAI\n',
    '/config/kwinrc': '[org.kde.kdecoration2]\nButtonsOnLeft=\nButtonsOnRight=IAX\n',
  };
  const read = async (file: string) => { if (file in kwinrc) return kwinrc[file]; throw Error('missing'); };
  assert.deepEqual(await detectWindowButtons({ env: { XDG_CURRENT_DESKTOP: 'KDE', XDG_CONFIG_HOME: '/config' }, exec, read }), { side: 'right', buttons: ['minimize', 'maximize', 'close'] }, "The user's kwinrc overrides the system one");
  assert.deepEqual(await detectWindowButtons({ env: { XDG_CURRENT_DESKTOP: 'KDE', XDG_CONFIG_HOME: '/none' }, exec, read }), { side: 'left', buttons: ['close', 'minimize', 'maximize'] }, 'A system kwinrc sets the default');
  assert.deepEqual(await detectWindowButtons({ env: { XDG_CURRENT_DESKTOP: 'KDE', XDG_CONFIG_HOME: '/none', XDG_CONFIG_DIRS: '/vendor:/etc/xdg' }, exec, read }), { side: 'left', buttons: ['close', 'maximize', 'minimize'] }, 'Earlier XDG_CONFIG_DIRS win');
  // GNOME's schema is often installed but unset elsewhere; its default would
  // leave only a close button.
  calls.length = 0;
  for (const desktop of [undefined, 'LXQt', 'COSMIC', 'sway', 'Hyprland']) {
    assert.equal(await detectWindowButtons({ env: desktop ? { XDG_CURRENT_DESKTOP: desktop } : {}, exec }), null, `${desktop ?? 'No desktop'} keeps the page default`);
  }
  assert.deepEqual(calls, []);
  for (const desktop of ['Unity', 'Budgie:GNOME', 'Pantheon']) {
    await detectWindowButtons({ env: { XDG_CURRENT_DESKTOP: desktop }, exec });
    assert.equal(calls.at(-1)?.[2], 'org.gnome.desktop.wm.preferences', desktop);
  }
  assert.equal(await detectWindowButtons({ env: { XDG_CURRENT_DESKTOP: 'GNOME' }, exec: async () => { throw Error('no gsettings'); } }), null, 'Unreadable layouts fall back to the page default');
});

test('the layout reaches the preload as one JSON argument', () => {
  const argument = windowButtonsArgument({ side: 'right', buttons: ['close'] });
  assert.ok(argument.startsWith(WINDOW_BUTTONS_ARGUMENT));
  assert.deepEqual(JSON.parse(argument.slice(WINDOW_BUTTONS_ARGUMENT.length)), { side: 'right', buttons: ['close'] });
});
