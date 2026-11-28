// Progressive enhancement for the static user documentation:
// 1. Instant search dialog (<dialog closedby="any"> with Safari fallback)
// 2. Copy-code buttons (Invoker Commands --copy with CommandEvent fallback)
// 3. Right-rail TOC scrollspy (IntersectionObserver)
// 4. Mobile navigation Escape handling
(() => {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

  // --- Search modal ---
  const dialog = document.getElementById('guide-search-dialog');
  const triggers = [...document.querySelectorAll('[data-guide-search-open]')];
  if (dialog && triggers.length) {
    for (const trigger of triggers) {
      trigger.hidden = false;
      const kbd = trigger.querySelector('kbd');
      if (kbd && !isMac) kbd.textContent = 'Ctrl K';
    }
    const input = document.getElementById('guide-search-input');
    const results = document.getElementById('guide-search-results');
    const status = document.getElementById('guide-search-status');
    const indexUrl = dialog.dataset.index;
    const labels = {
      empty: dialog.dataset.empty || 'Type to search topics, commands and settings.',
      noResults: dialog.dataset.noResults || 'No matching sections found.',
      count: dialog.dataset.count || '{n} results',
      experimental: dialog.dataset.experimental || 'Experimental',
      loadError: dialog.dataset.loadError || 'Search index could not be loaded.',
    };
    let entries = null;
    let loadPromise = null;
    let activeIndex = -1;

    const loadIndex = () => {
      if (entries) return Promise.resolve(entries);
      if (!loadPromise) {
        loadPromise = fetch(indexUrl)
          .then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
          .then(data => { entries = data; return entries; })
          .catch(() => { loadPromise = null; return null; });
      }
      return loadPromise;
    };

    const escapeHtml = value => String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');

    const scoreEntry = (entry, rawQuery) => {
      const q = rawQuery.trim().toLowerCase();
      if (!q) return 0;
      const tokens = q.split(/\s+/).filter(Boolean);
      const title = entry.title.toLowerCase();
      const heading = (entry.heading || '').toLowerCase();
      const group = (entry.group || '').toLowerCase();
      const excerpt = (entry.excerpt || '').toLowerCase();
      const haystack = `${title} ${heading} ${group} ${excerpt}`;
      for (const token of tokens) {
        if (!haystack.includes(token)) return 0;
      }
      let score = 0;
      if (heading === q || title === q) score += 120;
      if (heading.includes(q)) score += 60;
      if (title.includes(q)) score += 50;
      if (group.includes(q)) score += 20;
      if (excerpt.includes(q)) score += 15;
      for (const token of tokens) {
        if (heading.includes(token)) score += 16;
        if (title.includes(token)) score += 14;
        if (excerpt.includes(token)) score += 4;
      }
      if (!entry.heading) score += 3;
      return score;
    };

    const setActive = (nextIndex, moveFocus = false) => {
      const items = [...results.querySelectorAll('li[role="option"]')];
      activeIndex = items.length ? Math.max(0, Math.min(nextIndex, items.length - 1)) : -1;
      items.forEach((item, idx) => {
        const link = item.querySelector('a');
        const active = idx === activeIndex;
        item.setAttribute('aria-selected', active ? 'true' : 'false');
        if (link) {
          if (active) {
            link.setAttribute('data-active', '');
            link.scrollIntoView({ block: 'nearest' });
            if (moveFocus) link.focus();
          } else {
            link.removeAttribute('data-active');
          }
        }
      });
      if (activeIndex >= 0 && items[activeIndex]?.id) {
        input.setAttribute('aria-activedescendant', items[activeIndex].id);
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    };

    const renderResults = query => {
      const trimmed = query.trim();
      if (!trimmed) {
        results.innerHTML = '';
        status.textContent = labels.empty;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        activeIndex = -1;
        return;
      }
      if (!entries) return;
      const matches = entries
        .map(entry => ({ entry, score: scoreEntry(entry, trimmed) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 14);
      if (!matches.length) {
        results.innerHTML = '';
        status.textContent = labels.noResults;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        activeIndex = -1;
        return;
      }
      status.textContent = labels.count.replace('{n}', String(matches.length));
      input.setAttribute('aria-expanded', 'true');
      results.innerHTML = matches.map(({ entry }, idx) => {
        const badge = entry.status === 'experimental'
          ? `<span class="guide-badge guide-badge-experimental">${escapeHtml(labels.experimental)}</span>`
          : '';
        const kicker = entry.heading
          ? `${escapeHtml(entry.group)} · ${escapeHtml(entry.title)}`
          : escapeHtml(entry.group);
        const primary = entry.heading || entry.title;
        return `<li id="guide-search-opt-${idx}" role="option" aria-selected="false"><a href="${escapeHtml(entry.url)}"><span class="guide-search-kicker">${kicker}${badge}</span><strong>${escapeHtml(primary)}</strong>${entry.excerpt ? `<span class="guide-search-excerpt">${escapeHtml(entry.excerpt)}</span>` : ''}</a></li>`;
      }).join('');
      setActive(0);
    };

    const openSearch = async () => {
      if (dialog.open) return;
      dialog.showModal();
      input.focus();
      input.select();
      const loaded = await loadIndex();
      if (!loaded) {
        status.textContent = labels.loadError;
        return;
      }
      renderResults(input.value);
    };

    for (const trigger of triggers) trigger.addEventListener('click', openSearch);

    input.addEventListener('input', () => {
      if (entries) renderResults(input.value);
      else loadIndex().then(loaded => {
        if (loaded) renderResults(input.value);
        else status.textContent = labels.loadError;
      });
    });

    results.addEventListener('focusin', event => {
      const item = event.target.closest('li[role="option"]');
      if (!item) return;
      const idx = [...results.querySelectorAll('li[role="option"]')].indexOf(item);
      if (idx >= 0) setActive(idx);
    });

    dialog.addEventListener('keydown', event => {
      const links = [...results.querySelectorAll('a')];
      if (!links.length) return;
      const onResultLink = Boolean(document.activeElement?.closest('#guide-search-results a'));
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive(activeIndex < links.length - 1 ? activeIndex + 1 : 0, onResultLink);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive(activeIndex > 0 ? activeIndex - 1 : links.length - 1, onResultLink);
      } else if (event.key === 'Enter' && document.activeElement === input && activeIndex >= 0) {
        event.preventDefault();
        links[activeIndex].click();
      }
    });

    results.addEventListener('click', event => {
      const link = event.target.closest('a');
      if (!link) return;
      const targetUrl = new URL(link.href, location.href);
      if (targetUrl.pathname === location.pathname) dialog.close();
    });

    dialog.addEventListener('close', () => {
      dialog.returnValue = '';
    });

    // Fallback for browsers without native <dialog closedby="any"> support (e.g., Safari).
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const outside = event => {
        const rect = dialog.getBoundingClientRect();
        return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
      };
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', event => { pressedOutside = outside(event); });
      dialog.addEventListener('pointerup', event => { if (pressedOutside && outside(event)) dialog.close(); });
    }

    document.addEventListener('keydown', event => {
      if (dialog.open) return;
      const tag = event.target?.tagName;
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable;
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        openSearch();
      } else if (event.key === '/' && !editing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        openSearch();
      }
    });
  }

  // --- Copy-code buttons (Invoker Commands + CommandEvent fallback) ---
  for (const button of document.querySelectorAll('.guide-copy-button[hidden]')) button.hidden = false;
  const timers = new WeakMap();
  let lastAnnouncement = '';

  const report = (button, ok) => {
    const tip = button.nextElementSibling;
    if (!tip) return;
    clearTimeout(timers.get(button));
    button.removeAttribute('data-copied');
    button.removeAttribute('data-failed');
    let message = ok
      ? (button.dataset.copiedLabel || 'Copied')
      : (button.dataset.failedLabel || 'Copy failed');
    if (message === lastAnnouncement) message += '\u00A0';
    lastAnnouncement = message;
    tip.textContent = '';
    void button.offsetWidth;
    button.setAttribute(ok ? 'data-copied' : 'data-failed', '');
    requestAnimationFrame(() => { tip.textContent = message; });
    timers.set(button, setTimeout(() => {
      button.removeAttribute('data-copied');
      button.removeAttribute('data-failed');
      tip.textContent = '';
    }, 2000));
  };

  const copyFrom = async (button, target) => {
    const value = target.innerText.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      report(button, true);
    } catch {
      report(button, false);
    }
  };

  if ('CommandEvent' in window) {
    document.addEventListener('command', event => {
      if (event.command === '--copy' && event.source && event.target) {
        copyFrom(event.source, event.target);
      }
    }, true);
  } else {
    document.addEventListener('click', event => {
      const button = event.target.closest('button[command="--copy"]');
      if (!button) return;
      const target = document.getElementById(button.getAttribute('commandfor') || '');
      if (target) copyFrom(button, target);
    });
  }

  // --- Right-rail TOC ScrollSpy (progressive enhancement) ---
  const tocLinks = [...document.querySelectorAll('.guide-toc a[href^="#"]')];
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const linkById = new Map(tocLinks.map(link => [decodeURIComponent(link.hash.slice(1)), link]));
    const headings = [...linkById.keys()].map(id => document.getElementById(id)).filter(Boolean);
    const setCurrent = id => {
      for (const [key, link] of linkById) {
        if (key === id) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    };
    if (headings.length) {
      setCurrent(headings[0].id);
      const visible = new Set();
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const firstVisible = headings.find(h => visible.has(h.id));
        if (firstVisible) {
          setCurrent(firstVisible.id);
          return;
        }
        const passed = headings.filter(h => h.getBoundingClientRect().top <= 140);
        if (passed.length) setCurrent(passed.at(-1).id);
      }, { rootMargin: '-112px 0px -65% 0px', threshold: 0 });
      for (const heading of headings) observer.observe(heading);
    }
  }

  // Close mobile nav details on Escape.
  const mobileNav = document.querySelector('.guide-mobile-nav');
  mobileNav?.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobileNav.open) {
      mobileNav.open = false;
      mobileNav.querySelector('summary')?.focus();
    }
  });
})();
