/**
 * Fake Home Assistant data for the self-test and the property-inspector
 * preview. Deliberately contains three lights all named "Deckenlicht" — the
 * exact situation this plugin exists to fix.
 */
(function (global) {
  'use strict';

  // Ages are relative to load time so {{age}} shows something sensible.
  const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

  const states = [
    {
      entity_id: 'light.decke_wz',
      state: 'on',
      last_changed: minutesAgo(42),
      attributes: { friendly_name: 'Deckenlicht', brightness: 180, rgb_color: [255, 196, 120] }
    },
    { entity_id: 'light.decke_kueche', state: 'off', attributes: { friendly_name: 'Deckenlicht' } },
    {
      entity_id: 'light.decke_bad',
      state: 'on',
      attributes: { friendly_name: 'Deckenlicht', brightness: 60 }
    },
    {
      entity_id: 'light.stehlampe',
      state: 'off',
      attributes: { friendly_name: 'Stehlampe hinter dem Sofa links' }
    },
    { entity_id: 'light.flur', state: 'off', attributes: { friendly_name: 'Flurlicht' } },
    {
      entity_id: 'sensor.aussen_temp',
      state: '21.42',
      last_changed: minutesAgo(7),
      attributes: { friendly_name: 'Außentemperatur', unit_of_measurement: '°C' }
    },
    {
      entity_id: 'cover.wz_rollo',
      state: 'open',
      attributes: { friendly_name: 'Rollo', current_position: 65 }
    },
    { entity_id: 'lock.haustuer', state: 'locked', attributes: { friendly_name: 'Haustür' } },
    {
      entity_id: 'switch.kaffee',
      state: 'unavailable',
      attributes: { friendly_name: 'Kaffeemaschine' }
    },
    { entity_id: 'switch.wz_steckdose', state: 'on', attributes: { friendly_name: 'Steckdose TV' } },
    { entity_id: 'scene.abend', state: 'unknown', attributes: { friendly_name: 'Abendlicht' } },
    {
      entity_id: 'media_player.wz_sonos',
      state: 'playing',
      attributes: { friendly_name: 'Sonos', volume_level: 0.35 }
    },
    {
      entity_id: 'sensor.wz_akku',
      state: '88',
      attributes: { friendly_name: 'Akku', unit_of_measurement: '%' }
    }
  ];

  const registry = {
    'config/area_registry/list': [
      { area_id: 'wz', name: 'Wohnzimmer', floor_id: 'eg' },
      { area_id: 'kueche', name: 'Küche', floor_id: 'eg' },
      { area_id: 'bad', name: 'Badezimmer', floor_id: 'og' },
      { area_id: 'flur', name: 'Flur' }
    ],
    'config/floor_registry/list': [
      { floor_id: 'eg', name: 'Erdgeschoss' },
      { floor_id: 'og', name: 'Obergeschoss' }
    ],
    'config/device_registry/list': [
      { id: 'dev1', name: 'Hue Ceiling WZ', area_id: 'wz' },
      { id: 'dev2', name: 'Shelly Küche', name_by_user: 'Küchenlampe', area_id: 'kueche' },
      { id: 'dev3', name: 'Sonos One', area_id: 'wz' }
    ],
    'config/entity_registry/list': [
      { entity_id: 'light.decke_wz', device_id: 'dev1' },
      { entity_id: 'light.decke_kueche', device_id: 'dev2' },
      { entity_id: 'light.decke_bad', area_id: 'bad' },
      { entity_id: 'light.flur', area_id: 'flur' },
      { entity_id: 'light.stehlampe', area_id: 'wz' },
      { entity_id: 'sensor.aussen_temp', area_id: 'wz' },
      { entity_id: 'cover.wz_rollo', area_id: 'wz' },
      { entity_id: 'lock.haustuer' },
      { entity_id: 'switch.kaffee', area_id: 'kueche' },
      { entity_id: 'switch.wz_steckdose', area_id: 'wz' },
      { entity_id: 'scene.abend' },
      { entity_id: 'media_player.wz_sonos', device_id: 'dev3' },
      { entity_id: 'sensor.wz_akku', area_id: 'wz', entity_category: 'diagnostic' }
    ]
  };

  global.HA_FIXTURES = { states: states, registry: registry };
})(window);
