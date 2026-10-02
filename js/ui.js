/**
 * ui.js — 自定义 UI 组件库（v1.2.0）
 * 玻璃拟态风格：Modal / Select / Tooltip
 * 替代浏览器原生 alert/prompt/confirm/select/title
 */
'use strict';

const UI = (function () {
  let zIndex = 10000;

  const Modal = {
    alert(message, opts) {
      opts = opts || {};
      return new Promise(resolve => {
        showModal({
          title: opts.title || '提示',
          body: typeof message === 'string' ? `<div class="ui-modal-msg">${escapeHtml(message)}</div>` : message,
          buttons: [
            { text: opts.okText || '确定', primary: true, action: () => resolve() },
          ],
          icon: opts.icon,
        });
      });
    },

    confirm(message, opts) {
      opts = opts || {};
      return new Promise(resolve => {
        showModal({
          title: opts.title || '确认',
          body: typeof message === 'string' ? `<div class="ui-modal-msg">${escapeHtml(message)}</div>` : message,
          buttons: [
            { text: opts.cancelText || '取消', action: () => resolve(false) },
            { text: opts.okText || '确定', primary: true, action: () => resolve(true) },
          ],
          icon: opts.icon,
        });
      });
    },

    prompt(message, defaultValue, opts) {
      opts = opts || {};
      return new Promise(resolve => {
        const inputId = 'ui-prompt-input-' + Date.now();
        showModal({
          title: opts.title || '输入',
          body: `
            <div class="ui-modal-msg">${escapeHtml(message)}</div>
            <input type="text" class="ui-modal-input" id="${inputId}" value="${escapeAttr(defaultValue || '')}" placeholder="${escapeAttr(opts.placeholder || '')}">
          `,
          buttons: [
            { text: opts.cancelText || '取消', action: () => resolve(null) },
            {
              text: opts.okText || '确定', primary: true,
              action: () => {
                const el = document.getElementById(inputId);
                resolve(el ? el.value : '');
              },
            },
          ],
          icon: opts.icon,
          onOpen: () => {
            const el = document.getElementById(inputId);
            if (el) { el.focus(); el.select(); }
          },
        });
      });
    },
  };

  function showModal(cfg) {
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-overlay';
    overlay.style.zIndex = ++zIndex;

    const modal = document.createElement('div');
    modal.className = 'ui-modal';

    let iconHtml = '';
    if (cfg.icon) {
      iconHtml = `<div class="ui-modal-icon">${cfg.icon}</div>`;
    }

    modal.innerHTML = `
      ${iconHtml}
      <div class="ui-modal-title">${escapeHtml(cfg.title || '')}</div>
      <div class="ui-modal-body">${cfg.body || ''}</div>
      <div class="ui-modal-buttons"></div>
    `;

    const btnContainer = modal.querySelector('.ui-modal-buttons');
    (cfg.buttons || []).forEach(btn => {
      const el = document.createElement('button');
      el.className = 'ui-modal-btn' + (btn.primary ? ' primary' : '');
      el.textContent = btn.text;
      el.addEventListener('click', () => {
        closeModal(overlay);
        if (btn.action) btn.action();
      });
      btnContainer.appendChild(el);
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => {
      if (e.target === overlay && !modal.querySelector('input')) {
        closeModal(overlay);
        const cancelBtn = cfg.buttons.find(b => !b.primary);
        if (cancelBtn && cancelBtn.action) cancelBtn.action();
      }
    });

    const escHandler = e => {
      if (e.key === 'Escape') {
        closeModal(overlay);
        document.removeEventListener('keydown', escHandler);
        const cancelBtn = cfg.buttons.find(b => !b.primary);
        if (cancelBtn && cancelBtn.action) cancelBtn.action();
      }
    };
    document.addEventListener('keydown', escHandler);

    requestAnimationFrame(() => overlay.classList.add('show'));

    if (cfg.onOpen) setTimeout(cfg.onOpen, 50);
  }

  function closeModal(overlay) {
    overlay.classList.remove('show');
    setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 200);
  }

  const openSelects = [];

  const Select = {
    replace(selectEl, onChange) {
      if (!selectEl || selectEl.dataset.uiReplaced) return;
      selectEl.dataset.uiReplaced = '1';
      selectEl.style.display = 'none';

      const wrapper = document.createElement('div');
      wrapper.className = 'ui-select-wrap';

      const trigger = document.createElement('div');
      trigger.className = 'ui-select-trigger';
      updateTrigger();

      const dropdown = document.createElement('div');
      dropdown.className = 'ui-select-dropdown';
      dropdown.style.display = 'none';

      wrapper.appendChild(trigger);
      wrapper.appendChild(dropdown);
      selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);

      trigger.addEventListener('click', e => {
        e.stopPropagation();
        toggleDropdown();
      });

      function updateTrigger() {
        const opt = selectEl.options[selectEl.selectedIndex];
        trigger.innerHTML = `<span class="ui-select-value">${opt ? escapeHtml(opt.text) : ''}</span><span class="ui-select-arrow">▾</span>`;
      }

      function buildOptions() {
        dropdown.innerHTML = '';
        Array.from(selectEl.options).forEach(opt => {
          const item = document.createElement('div');
          item.className = 'ui-select-option' + (opt.selected ? ' selected' : '');
          item.textContent = opt.text;
          item.addEventListener('click', e => {
            e.stopPropagation();
            selectEl.value = opt.value;
            updateTrigger();
            closeDropdown();
            if (onChange) onChange(opt.value);
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          });
          dropdown.appendChild(item);
        });
      }

      function toggleDropdown() {
        if (dropdown.style.display === 'none') {
          closeAllSelects();
          buildOptions();
          dropdown.style.display = 'block';
          dropdown.style.zIndex = ++zIndex;
          const rect = trigger.getBoundingClientRect();
          const spaceBelow = window.innerHeight - rect.bottom;
          const ddHeight = Math.min(dropdown.scrollHeight, 240);
          if (spaceBelow < ddHeight + 10 && rect.top > ddHeight) {
            dropdown.style.bottom = '100%';
            dropdown.style.top = 'auto';
            dropdown.style.marginBottom = '4px';
          } else {
            dropdown.style.top = '100%';
            dropdown.style.bottom = 'auto';
            dropdown.style.marginTop = '4px';
          }
          openSelects.push({ dropdown, wrapper });
          requestAnimationFrame(() => dropdown.classList.add('show'));
        } else {
          closeDropdown();
        }
      }

      function closeDropdown() {
        dropdown.classList.remove('show');
        setTimeout(() => { dropdown.style.display = 'none'; }, 150);
        const idx = openSelects.findIndex(s => s.dropdown === dropdown);
        if (idx >= 0) openSelects.splice(idx, 1);
      }

      const observer = new MutationObserver(updateTrigger);
      observer.observe(selectEl, { attributes: true, childList: true, subtree: true });
    },

    scan(container, onChange) {
      if (!container) return;
      container.querySelectorAll('select:not([data-ui-replaced])').forEach(sel => {
        Select.replace(sel, onChange);
      });
    },
  };

  function closeAllSelects() {
    openSelects.forEach(s => {
      s.dropdown.classList.remove('show');
      setTimeout(() => { s.dropdown.style.display = 'none'; }, 150);
    });
    openSelects.length = 0;
  }

  document.addEventListener('click', closeAllSelects);
  document.addEventListener('scroll', closeAllSelects, true);

  let tooltipEl = null;
  let tooltipTarget = null;

  const Tooltip = {
    bind(el, text) {
      if (!el) return;
      el.removeAttribute('title');
      el.dataset.uiTooltip = text;
      el.addEventListener('mouseenter', onTooltipEnter);
      el.addEventListener('mouseleave', onTooltipLeave);
    },

    scan(container) {
      if (!container) return;
      container.querySelectorAll('[title]').forEach(el => {
        Tooltip.bind(el, el.getAttribute('title'));
      });
    },
  };

  function onTooltipEnter(e) {
    const el = e.currentTarget;
    const text = el.dataset.uiTooltip;
    if (!text) return;
    tooltipTarget = el;
    showTooltip(text, el);
  }

  function onTooltipLeave() {
    tooltipTarget = null;
    hideTooltip();
  }

  function showTooltip(text, anchorEl) {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'ui-tooltip';
      document.body.appendChild(tooltipEl);
    }
    tooltipEl.textContent = text;
    tooltipEl.style.zIndex = ++zIndex;
    tooltipEl.style.visibility = 'hidden';
    tooltipEl.style.display = 'block';

    const rect = anchorEl.getBoundingClientRect();
    const ttRect = tooltipEl.getBoundingClientRect();

    let left = rect.left + rect.width / 2 - ttRect.width / 2;
    let top = rect.top - ttRect.height - 8;

    if (left < 8) left = 8;
    if (left + ttRect.width > window.innerWidth - 8) left = window.innerWidth - ttRect.width - 8;
    if (top < 8) top = rect.bottom + 8;

    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
    tooltipEl.style.visibility = 'visible';
    requestAnimationFrame(() => tooltipEl.classList.add('show'));
  }

  function hideTooltip() {
    if (tooltipEl) {
      tooltipEl.classList.remove('show');
      setTimeout(() => { if (tooltipEl && !tooltipTarget) tooltipEl.style.display = 'none'; }, 150);
    }
  }

  function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return { Modal, Select, Tooltip };
})();
