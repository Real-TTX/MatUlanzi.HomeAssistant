/**
 * The library: Home Assistant connections, folders and button definitions, all
 * stored in UlanziStudio's global settings.
 *
 * A key on the deck holds nothing but a reference (`{button: "<id>"}`), so the
 * same button can sit on several keys and editing it in the designer updates
 * all of them at once.
 *
 * A button drives one entity or several (a group). For groups, `group_rule`
 * decides what the key shows when the members disagree.
 */
(function (global) {
  'use strict';

  const VERSION = 1;

  /**
   * Ulanzi Studio answers `getGlobalSettings` from the bucket of the *sender*,
   * so every page would otherwise read a different one: the main service runs
   * under the plugin uuid, inspectors under the action uuid, the designer under
   * its own. Passing this one fixed context pins all of them to the same bucket.
   *
   * On disk (Config/global_settings.json) Studio keys the store by **uuid
   * alone** and discards the key/actionid part. So this is really "the plugin
   * uuid bucket", and there can only ever be ONE of them: anything else written
   * under this uuid overwrites the library. Learned the hard way — a throwaway
   * write to a different context under the same uuid wiped a real library.
   */
  const LIBRARY_CONTEXT = 'com.ulanzi.ulanzistudio.matUlanziHa___library___library';

  /**
   * Guards every library write: an empty payload must never replace content.
   * Studio keeps no backup, so one bad write is unrecoverable — and the store is
   * keyed by uuid only, which makes stray writes easy. Returns true when the
   * write may go ahead.
   */
  function mayReplaceLibrary(next, previous) {
    const size = (blob) =>
      blob ? ((blob.buttons || []).length + (blob.connections || []).length) : 0;
    if (size(next) > 0) return true;
    return size(previous) === 0;
  }

  /** How a group's members combine into the single state a key can show. */
  const GROUP_RULES = Object.freeze({
    any_on: 'any_on', // one member on is enough -> key shows ON
    all_on: 'all_on' // every member must be on -> key shows ON
  });

  function newId(prefix) {
    return (
      (prefix || 'id') +
      '-' +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 6)
    );
  }

  /**
   * What a button does when pressed.
   *
   * `info` is display-only. Note that its refresh interval is *not* needed to
   * keep values current — states arrive pushed via subscribe_events. It exists
   * for time-dependent templates such as `{{age}}`, which nothing else would
   * redraw.
   */
  const BUTTON_TYPES = Object.freeze({
    toggle: { label: 'Button (switches)', acts: true },
    info: { label: 'Info (display only)', acts: false }
  });

  class Library {
    constructor(data) {
      const source = data || {};
      this.version = source.version || VERSION;
      this.connections = Array.isArray(source.connections) ? source.connections.slice() : [];
      this.folders = Array.isArray(source.folders) ? source.folders.slice() : [];
      this.buttons = Array.isArray(source.buttons) ? source.buttons.slice() : [];

      // Global settings written before the library existed carried a single
      // flat connection. Keep those users connected.
      if (!this.connections.length && (source.ha_url || source.ha_token)) {
        this.connections.push({
          id: 'default',
          name: 'Home Assistant',
          url: source.ha_url || '',
          token: source.ha_token || ''
        });
      }
    }

    static parse(data) {
      return new Library(data);
    }

    /** Plain object for setGlobalSettings. */
    toJSON() {
      return {
        version: VERSION,
        connections: this.connections,
        folders: this.folders,
        buttons: this.buttons
      };
    }

    // --- connections --------------------------------------------------------

    connection(id) {
      if (!id) return this.defaultConnection();
      return this.connections.find((entry) => entry.id === id) || null;
    }

    defaultConnection() {
      return this.connections.length ? this.connections[0] : null;
    }

    addConnection(values) {
      const entry = Object.assign(
        { id: newId('conn'), name: 'Home Assistant', url: '', token: '' },
        values || {}
      );
      this.connections.push(entry);
      return entry;
    }

    updateConnection(id, values) {
      const entry = this.connection(id);
      if (!entry) return null;
      Object.assign(entry, values || {}, { id: entry.id });
      return entry;
    }

    removeConnection(id) {
      const index = this.connections.findIndex((entry) => entry.id === id);
      if (index === -1) return false;
      this.connections.splice(index, 1);
      // Buttons pointing at it fall back to the default connection.
      for (const button of this.buttons) {
        if (button.connection === id) button.connection = '';
      }
      return true;
    }

    // --- folders ------------------------------------------------------------

    folder(id) {
      if (!id) return null;
      return this.folders.find((entry) => entry.id === id) || null;
    }

    addFolder(values) {
      const entry = Object.assign({ id: newId('fld'), name: 'Neuer Ordner' }, values || {});
      this.folders.push(entry);
      return entry;
    }

    updateFolder(id, values) {
      const entry = this.folder(id);
      if (!entry) return null;
      Object.assign(entry, values || {}, { id: entry.id });
      return entry;
    }

    /** Deleting a folder keeps its buttons; they move back to the top level. */
    removeFolder(id) {
      const index = this.folders.findIndex((entry) => entry.id === id);
      if (index === -1) return false;
      this.folders.splice(index, 1);
      for (const button of this.buttons) {
        if (button.folder === id) button.folder = '';
      }
      return true;
    }

    sortedFolders() {
      return this.folders
        .slice()
        .sort((a, b) =>
          String(a.name).localeCompare(String(b.name), undefined, { numeric: true })
        );
    }

    /**
     * Buttons grouped for display: every folder in name order, each with its
     * buttons in name order, and the folderless ones last.
     * @returns {Array<{folder: object|null, buttons: object[]}>}
     */
    tree() {
      const byName = (a, b) =>
        String(a.name).localeCompare(String(b.name), undefined, { numeric: true });

      const groups = this.sortedFolders().map((folder) => ({
        folder: folder,
        buttons: this.buttons.filter((button) => button.folder === folder.id).sort(byName)
      }));

      const loose = this.buttons
        .filter((button) => !button.folder || !this.folder(button.folder))
        .sort(byName);
      if (loose.length) groups.push({ folder: null, buttons: loose });

      return groups;
    }

    // --- buttons ------------------------------------------------------------

    button(id) {
      if (!id) return null;
      return this.buttons.find((entry) => entry.id === id) || null;
    }

    addButton(values) {
      const entry = Object.assign(
        {
          id: newId('btn'),
          name: 'Neuer Button',
          folder: '',
          connection: this.defaultConnection() ? this.defaultConnection().id : '',
          type: 'toggle',
          entities: [],
          refresh_interval: 0,
          group_rule: GROUP_RULES.any_on,
          open_target: 'entity',
          service_domain: '',
          service_name: '',
          service_data: '',
          step_amount: 1,
          target_mode: 'fixed',
          long_press: 'identify',
          long_press_button: '',
          on_data: '',
          off_data: '',
          entity_actions: {},
          open_area: '',
          open_dashboard: '',
          open_url: '',
          style: {}
        },
        values || {}
      );
      this.buttons.push(entry);
      return entry;
    }

    updateButton(id, values) {
      const entry = this.button(id);
      if (!entry) return null;
      Object.assign(entry, values || {}, { id: entry.id });
      return entry;
    }

    duplicateButton(id) {
      const entry = this.button(id);
      if (!entry) return null;
      const copy = JSON.parse(JSON.stringify(entry));
      copy.id = newId('btn');
      copy.name = entry.name + ' (Kopie)';
      this.buttons.push(copy);
      return copy;
    }

    removeButton(id) {
      const index = this.buttons.findIndex((entry) => entry.id === id);
      if (index === -1) return false;
      this.buttons.splice(index, 1);
      return true;
    }

    sortedButtons() {
      return this.buttons
        .slice()
        .sort((a, b) =>
          String(a.name).localeCompare(String(b.name), undefined, { numeric: true })
        );
    }

    /**
     * The entities a button drives. `entities` wins; `entity_id` is still read
     * so buttons created before groups existed keep working.
     * @returns {string[]}
     */
    static entitiesOf(button) {
      if (!button) return [];
      const list = Array.isArray(button.entities) ? button.entities.filter(Boolean) : [];
      if (list.length) return list;
      return button.entity_id ? [button.entity_id] : [];
    }

    /**
     * What a key should show. Accepts either a reference to a library button or
     * — for keys configured before the library existed — the inline settings.
     */
    resolveKey(settings) {
      const keySettings = settings || {};
      const button = this.button(keySettings.button);

      if (button) {
        const entities = Library.entitiesOf(button);
        return {
          source: 'library',
          id: button.id,
          name: button.name,
          folder: button.folder || '',
          connection: button.connection,
          type: button.type || 'toggle',
          refreshInterval: Number(button.refresh_interval) || 0,
          entityIds: entities,
          entityId: entities[0] || '',
          groupRule: button.group_rule === GROUP_RULES.all_on ? GROUP_RULES.all_on : GROUP_RULES.any_on,
          // Everything an 'open' key needs; harmless on the other types.
          // Follows the device picked on another key instead of a fixed one.
          targetMode: button.target_mode === 'context' ? 'context' : 'fixed',
          longPress: button.long_press || 'identify',
          longPressButton: button.long_press_button || '',
          // How this button wants its devices switched, not just that.
          onData: button.on_data || '',
          offData: button.off_data || '',
          entityActions: button.entity_actions || {},
          service: {
            domain: button.service_domain || '',
            name: button.service_name || '',
            data: button.service_data || ''
          },
          stepAmount: Number(button.step_amount) || 0,
          open: {
            target: button.open_target || 'entity',
            entityId: entities[0] || '',
            area: button.open_area || '',
            dashboard: button.open_dashboard || '',
            url: button.open_url || ''
          },
          style: global.KeyStyle.mergeStyle(button.style, keySettings),
          label: keySettings.label || '',
          showRoom: keySettings.show_room
        };
      }

      if (keySettings.entity_id) {
        return {
          source: 'inline',
          id: '',
          name: '',
          folder: '',
          connection: keySettings.connection || '',
          type: 'toggle',
          refreshInterval: 0,
          entityIds: [keySettings.entity_id],
          entityId: keySettings.entity_id,
          groupRule: GROUP_RULES.any_on,
          targetMode: 'fixed',
          longPress: 'identify',
          longPressButton: '',
          onData: '',
          offData: '',
          entityActions: {},
          service: { domain: '', name: '', data: '' },
          stepAmount: 0,
          open: { target: 'entity', entityId: keySettings.entity_id, area: '', dashboard: '', url: '' },
          style: global.KeyStyle.mergeStyle(null, keySettings),
          label: keySettings.label || '',
          showRoom: keySettings.show_room
        };
      }

      return null;
    }
  }

  global.LIBRARY_CONTEXT = LIBRARY_CONTEXT;
  global.mayReplaceLibrary = mayReplaceLibrary;
  global.Library = Library;
  global.BUTTON_TYPES = BUTTON_TYPES;
  global.GROUP_RULES = GROUP_RULES;
  global.libraryNewId = newId;
})(window);
