import test from 'node:test';
import fs from 'node:fs';
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
  // Files are read separately, least important first, with KConfig's [$i] locks.
  const left = { side: 'left', buttons: ['close', 'minimize', 'maximize'] };
  assert.deepEqual(kwinLayout(['[org.kde.kdecoration2][$i]\nButtonsOnLeft=XIA\nButtonsOnRight=\n', '[org.kde.kdecoration2]\nButtonsOnLeft=\nButtonsOnRight=IAX\n']), left, 'A locked system group wins over the user');
  assert.deepEqual(kwinLayout(['[org.kde.kdecoration2][$i]\nButtonsOnLeft=XIA\n', '[org.kde.kdecoration2]\nButtonsOnRight=X\n']), left, 'A locked group also holds keys it leaves at their defaults');
  assert.deepEqual(kwinLayout(['[org.kde.kdecoration2]\nButtonsOnLeft[$i]=XIA\nButtonsOnRight=\n', '[org.kde.kdecoration2]\nButtonsOnLeft=\nButtonsOnRight=IAX\n']), left, 'A locked key wins over the user');
  assert.deepEqual(kwinLayout(['[$i]\n[org.kde.kdecoration2]\nButtonsOnLeft=XIA\nButtonsOnRight=\n', '[org.kde.kdecoration2]\nButtonsOnLeft=\nButtonsOnRight=IAX\n']), left, 'A locked file wins over the user');
  assert.deepEqual(kwinLayout(['[org.kde.kdecoration2]\nButtonsOnLeft=XIA\nButtonsOnRight=\n', '[org.kde.kdecoration2]\nButtonsOnLeft=\nButtonsOnRight=IAX\n']), { side: 'right', buttons: ['minimize', 'maximize', 'close'] }, 'Without a lock the user wins');
  assert.deepEqual(kwinLayout(['[org.kde.kdecoration2]\nButtonsOnLeft=X\nButtonsOnRight=\n', 'ButtonsOnLeft=IA\n']), { side: 'left', buttons: ['close'] }, "A group does not carry into the next file's ungrouped keys");
  assert.deepEqual(kwinLayout('[org.kde.kdecoration2]\nButtonsOnLeft=X\nButtonsOnRight=\n[org.kde.kdecoration2][Extra]\nButtonsOnLeft=IA\n'), { side: 'left', buttons: ['close'] }, 'Subgroups are other groups');
  assert.deepEqual(kwinLayout('[org.kde.kdecoration2]\nButtonsOnLeft=X\nButtonsOnRight=\nButtonsOnLeft[fr]=IA\n'), { side: 'left', buttons: ['close'] }, 'Localized entries are other keys');
  assert.deepEqual(kwinLayout(['[org.kde.kdecoration2][Extra][$i]\n', '[org.kde.kdecoration2]\nButtonsOnLeft=X\nButtonsOnRight=\n']), { side: 'left', buttons: ['close'] }, "A locked subgroup does not lock its parent");
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

test('detection gives up on a stalled lookup', async () => {
  const stalled = () => new Promise<string>(() => {});
  assert.equal(await detectWindowButtons({ env: { XDG_CURRENT_DESKTOP: 'KDE' }, read: stalled, timeout: 10 }), null);
  assert.equal(await detectWindowButtons({ env: { XDG_CURRENT_DESKTOP: 'GNOME' }, exec: stalled, timeout: 10 }), null);
});

test('the layout reaches the preload as one JSON argument', () => {
  // The sandboxed preload keeps its own copy of the prefix.
  assert.ok(fs.readFileSync(new URL('../desktop/preload.cts', import.meta.url), 'utf8').includes(`'${WINDOW_BUTTONS_ARGUMENT}'`));
  const argument = windowButtonsArgument({ side: 'right', buttons: ['close'] });
  assert.ok(argument.startsWith(WINDOW_BUTTONS_ARGUMENT));
  assert.deepEqual(JSON.parse(argument.slice(WINDOW_BUTTONS_ARGUMENT.length)), { side: 'right', buttons: ['close'] });
});
