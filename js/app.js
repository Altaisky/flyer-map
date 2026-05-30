const STORAGE_KEY = 'flyer-map-buildings';
const SETTINGS_KEY = 'flyer-map-settings';

const DEFAULT_CENTER = [55.7558, 37.6173];
const DEFAULT_ZOOM = 15;
const DEFAULT_COOLDOWN = 30;

let buildings = [];
let map;
let markers = {};
let currentFilter = 'all';
let nextId = 1;
let blockMapClick = false;
let isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let locationMarker = null;
let locationCircle = null;
let isTracking = false;
let locateAttempt = 0;
let tempMarker = null;
let tempComment = null;

function reverseGeocode(lat, lng, callback) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ru`);
  xhr.setRequestHeader('User-Agent', 'FlyerMap-PWA/1.0');
  xhr.onload = function() {
    if (xhr.status === 200) {
      try { callback(JSON.parse(xhr.responseText)); } catch (e) { callback(null); }
    } else { callback(null); }
  };
  xhr.onerror = function() { callback(null); };
  xhr.send();
}

function formatAddress(data) {
  if (!data || !data.address) return null;
  const a = data.address;
  const street = a.road || a.footway || a.pedestrian || a.path || '';
  const house = a.house_number || '';
  if (street && house) return `${street}, ${house}`;
  if (street) return street;
  if (house) return `Дом ${house}`;
  return data.display_name ? data.display_name.split(',')[0] : null;
}

function setBlockMapClick() {
  blockMapClick = true;
  setTimeout(function() { blockMapClick = false; }, 100);
}

function isSidebarOpen() {
  return document.getElementById('sidebar').classList.contains('open');
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
  document.body.classList.add('sidebar-open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
  document.body.classList.remove('sidebar-open');
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { cooldownDays: DEFAULT_COOLDOWN, center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
}

function saveSettings() {
  const settings = {
    cooldownDays: parseInt(document.getElementById('cooldown-days').value) || DEFAULT_COOLDOWN,
    center: map.getCenter(),
    zoom: map.getZoom()
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadBuildings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      buildings = JSON.parse(raw);
      if (buildings.length > 0) {
        nextId = Math.max.apply(null, buildings.map(function(b) { return b.id; })) + 1;
      }
    }
  } catch (e) { buildings = []; }
}

function saveBuildings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buildings));
}

function getStatus(building) {
  if (building.excluded) return 'excluded';
  if (building.status === 'commented') return 'commented';
  if (building.status === 'planned') return 'planned';
  if (building.status === 'done' && building.lastMarkedAt) {
    const cd = building.cooldownDays || parseInt(document.getElementById('cooldown-days').value) || DEFAULT_COOLDOWN;
    const markedDate = new Date(building.lastMarkedAt);
    const expiryDate = new Date(markedDate.getTime() + cd * 24 * 60 * 60 * 1000);
    return new Date() >= expiryDate ? 'planned' : 'active';
  }
  return 'planned';
}

function getRemainingText(building) {
  if (!building.lastMarkedAt) return null;
  const cd = building.cooldownDays || parseInt(document.getElementById('cooldown-days').value) || DEFAULT_COOLDOWN;
  const markedDate = new Date(building.lastMarkedAt);
  const expiryDate = new Date(markedDate.getTime() + cd * 24 * 60 * 60 * 1000);
  const diff = expiryDate - new Date();
  if (diff <= 0) return 'Готов к повторной обклейке!';
  return 'Осталось ' + Math.ceil(diff / (24 * 60 * 60 * 1000)) + ' дн.';
}

function createMarkerIcon(status, hasComment) {
  const size = isMobile ? 32 : 24;
  var cls = 'marker-icon marker-' + status;
  if (hasComment) cls += ' marker-has-comment';
  return L.divIcon({
    className: cls,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
}

function getChoicePopupContent(lat, lng) {
  var h = '<div class="popup-content">';
  h += '<h3>Новый дом</h3>';
  if (tempComment) {
    h += '<div class="building-comment">' + tempComment.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
  }
  h += '<div class="popup-actions">';
  h += '<button class="popup-btn popup-btn-mark" onclick="confirmNewBuilding(' + lat + ',' + lng + ',\'planned\')">Обклеить</button>';
  h += '<button class="popup-btn popup-btn-done" onclick="confirmNewBuilding(' + lat + ',' + lng + ',\'done\')">Обклеено</button>';
  h += '<button class="popup-btn popup-btn-exclude" onclick="confirmNewBuilding(' + lat + ',' + lng + ',\'excluded\')">Исключить</button>';
  h += '<button class="popup-btn popup-btn-comment" onclick="addTempComment()">💬</button>';
  h += '</div></div>';
  return h;
}

function getPopupContent(building) {
  var status = getStatus(building);
  var statusLabels = {
    planned: 'Обклеить',
    active: 'Обклеено',
    excluded: 'Исключён',
    commented: 'Закомментировано'
  };
  var remaining = getRemainingText(building);
  var markedDate = building.lastMarkedAt ? new Date(building.lastMarkedAt).toLocaleDateString('ru-RU') : null;

  var html = '<div class="popup-content">';
  html += '<h3>Дом #' + building.id + '</h3>';
  if (building.address) {
    html += '<div class="building-address">' + building.address + '</div>';
  } else if (!building.addressFetching && building.id > 0) {
    html += '<div class="building-address loading">Загрузка адреса...</div>';
  }
  html += '<span class="status status-' + status + '">' + (statusLabels[status] || '') + '</span>';
  if (building.comment) {
    html += '<div class="building-comment">' + building.comment.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
  }
  if (markedDate) {
    html += '<div class="timer">Обклеен: ' + markedDate + '</div>';
  }
  if (remaining) {
    html += '<div class="timer">' + remaining + '</div>';
  }
  html += '<div class="popup-actions">';

  if (status === 'planned' || status === 'commented') {
    if (building.status === 'done') {
      html += '<button class="popup-btn popup-btn-mark" onclick="planBuilding(' + building.id + ')">Обклеить</button>';
    }
    html += '<button class="popup-btn popup-btn-done" onclick="doneBuilding(' + building.id + ')">Обклеено</button>';
    html += '<button class="popup-btn popup-btn-exclude" onclick="excludeBuilding(' + building.id + ')">Исключить</button>';
  } else if (status === 'active') {
    html += '<button class="popup-btn popup-btn-mark" onclick="planBuilding(' + building.id + ')">Обклеить</button>';
    html += '<button class="popup-btn popup-btn-exclude" onclick="excludeBuilding(' + building.id + ')">Исключить</button>';
  } else if (status === 'excluded') {
    html += '<button class="popup-btn popup-btn-mark" onclick="planBuilding(' + building.id + ')">Обклеить</button>';
    html += '<button class="popup-btn popup-btn-done" onclick="doneBuilding(' + building.id + ')">Обклеено</button>';
  }

  html += '<button class="popup-btn popup-btn-delete" onclick="deleteBuilding(' + building.id + ')">Удалить</button>';
  html += '<button class="popup-btn popup-btn-comment" onclick="addComment(' + building.id + ')">💬</button>';
  html += '</div></div>';
  return html;
}

function addMarkerToMap(building) {
  var status = getStatus(building);
  var marker = L.marker([building.lat, building.lng], { icon: createMarkerIcon(status, !!building.comment || building.status === 'commented') }).addTo(map);
  marker.bindPopup(function() { return getPopupContent(building); }, { maxWidth: 250 });
  markers[building.id] = marker;
}

function refreshMarker(building) {
  var marker = markers[building.id];
  if (!marker) return;
  marker.setIcon(createMarkerIcon(getStatus(building), !!building.comment || building.status === 'commented'));
  marker.setPopupContent(getPopupContent(building));
}

function refreshAllMarkers() {
  buildings.forEach(function(b) { refreshMarker(b); applyFilterToMarker(b); });
  updateStats();
}

function applyFilterToMarker(building) {
  var marker = markers[building.id];
  if (!marker) return;
  var visible;
  if (currentFilter === 'commented') {
    visible = !!building.comment;
  } else {
    visible = currentFilter === 'all' || getStatus(building) === currentFilter;
  }
  if (visible) { if (!map.hasLayer(marker)) marker.addTo(map); }
  else { if (map.hasLayer(marker)) map.removeLayer(marker); }
}

function updateStats() {
  var counts = { planned: 0, active: 0, excluded: 0, commented: 0 };
  buildings.forEach(function(b) {
    var s = getStatus(b);
    if (s === 'planned') counts.planned++;
    else if (s === 'active') counts.active++;
    else if (s === 'excluded') counts.excluded++;
    if (s === 'commented') counts.commented++;
    if (b.comment && s !== 'commented') counts.commented++;
  });
  document.getElementById('count-planned').textContent = counts.planned;
  document.getElementById('count-active').textContent = counts.active;
  document.getElementById('count-excluded').textContent = counts.excluded;
  document.getElementById('count-commented').textContent = counts.commented;
  document.getElementById('count-total').textContent = buildings.length;
}

function initMap() {
  var settings = loadSettings();

  map = L.map('map', { center: settings.center, zoom: settings.zoom, zoomControl: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  document.getElementById('cooldown-days').value = settings.cooldownDays;

  map.on('click', function(e) {
    if (blockMapClick) { blockMapClick = false; return; }
    if (isMobile && isSidebarOpen()) { closeSidebar(); return; }
    if (tempMarker) {
      map.removeLayer(tempMarker);
      tempMarker = null;
    }
    removeTempMarker();
    var lat = Math.round(e.latlng.lat * 1000000) / 1000000;
    var lng = Math.round(e.latlng.lng * 1000000) / 1000000;
    var cls = 'marker-icon marker-temp';
    if (tempComment) cls += ' marker-has-comment';
    var icon = L.divIcon({
      className: cls,
      iconSize: [isMobile ? 32 : 24, isMobile ? 32 : 24],
      iconAnchor: [isMobile ? 16 : 12, isMobile ? 16 : 12],
      popupAnchor: [0, isMobile ? -16 : -12]
    });
    tempMarker = L.marker([lat, lng], { icon: icon }).addTo(map);
    tempMarker.bindPopup(getChoicePopupContent(lat, lng), { maxWidth: 250, closeButton: true });
    tempMarker.openPopup();
  });

  map.on('popupclose', function() {
    if (tempMarker) {
      setTimeout(function() {
        if (tempComment) {
          var lat = tempMarker.getLatLng().lat;
          var lng = tempMarker.getLatLng().lng;
          confirmNewBuilding(lat, lng, 'commented');
        } else {
          removeTempMarker();
        }
      }, 50);
    }
  });

  map.on('moveend zoomend', saveSettings);

  map.on('locationfound', function(e) {
    if (locationMarker) map.removeLayer(locationMarker);
    if (locationCircle) map.removeLayer(locationCircle);
    var radius = e.accuracy / 2;
    locationMarker = L.circleMarker(e.latlng, { radius: 8, fillColor: '#3498db', fillOpacity: 1, color: '#fff', weight: 3 });
    locationCircle = L.circle(e.latlng, { radius: radius, color: '#3498db', fillColor: '#3498db', fillOpacity: 0.15, weight: 2 });
    if (isTracking) { locationMarker.addTo(map); locationCircle.addTo(map); }
  });

  map.on('locationerror', function() {
    locateAttempt++;
    if (locateAttempt === 1) {
      var btn = document.getElementById('btn-locate');
      btn.classList.remove('tracking');
      btn.classList.add('tracking-wifi');
      showToast('Нет сигнала GPS. Определение по Wi-Fi и сотовым вышкам');
      map.stopLocate();
      map.locate({ setView: true, maxZoom: 17, watch: true, enableHighAccuracy: false, timeout: 15000 });
    } else {
      alert('Не удалось определить местоположение ни по GPS, ни по Wi-Fi. Проверьте, включена ли геолокация в настройках телефона.');
      stopLocating(document.getElementById('btn-locate'));
    }
  });

  loadBuildings();
  buildings.forEach(function(b) {
    if (!b.status || b.status === 'pending') b.status = 'planned';
    if (b.excluded === undefined) b.excluded = false;
    if (b.address === undefined) b.address = null;
    if (b.comment === undefined) b.comment = null;
  });
  buildings.forEach(function(b) {
    addMarkerToMap(b);
    if (!b.address && !b.addressFetching) {
      b.addressFetching = true;
      reverseGeocode(b.lat, b.lng, function(data) {
        b.address = formatAddress(data);
        b.addressFetching = false;
        refreshMarker(b);
        saveBuildings();
      });
    }
  });
  refreshAllMarkers();
}

function removeTempMarker() {
  if (!tempMarker) return;
  map.removeLayer(tempMarker);
  tempMarker = null;
  tempComment = null;
}

window.confirmNewBuilding = function(lat, lng, status) {
  setBlockMapClick();
  var comment = tempComment;
  removeTempMarker();
  map.closePopup();

  var building = {
    id: nextId++,
    lat: lat,
    lng: lng,
    status: status,
    excluded: status === 'excluded',
    cooldownDays: null,
    lastMarkedAt: status === 'done' ? new Date().toISOString() : null,
    address: null,
    addressFetching: false,
    comment: comment,
    createdAt: new Date().toISOString()
  };
  tempComment = null;

  buildings.push(building);
  addMarkerToMap(building);
  applyFilterToMarker(building);
  saveBuildings();
  updateStats();

  building.addressFetching = true;
  reverseGeocode(building.lat, building.lng, function(data) {
    building.address = formatAddress(data);
    building.addressFetching = false;
    refreshMarker(building);
    saveBuildings();
  });
};

window.planBuilding = function(id) {
  setBlockMapClick();
  var building = buildings.find(function(b) { return b.id === id; });
  if (!building) return;
  map.closePopup();
  building.status = 'planned';
  building.excluded = false;
  building.lastMarkedAt = null;
  building.cooldownDays = null;
  refreshMarker(building);
  applyFilterToMarker(building);
  saveBuildings();
  updateStats();
};

window.doneBuilding = function(id) {
  setBlockMapClick();
  var building = buildings.find(function(b) { return b.id === id; });
  if (!building) return;
  map.closePopup();
  building.status = 'done';
  building.excluded = false;
  building.lastMarkedAt = new Date().toISOString();
  building.cooldownDays = parseInt(document.getElementById('cooldown-days').value) || DEFAULT_COOLDOWN;
  refreshMarker(building);
  applyFilterToMarker(building);
  saveBuildings();
  updateStats();
};

window.excludeBuilding = function(id) {
  setBlockMapClick();
  var building = buildings.find(function(b) { return b.id === id; });
  if (!building) return;
  map.closePopup();
  building.excluded = true;
  building.status = 'excluded';
  building.lastMarkedAt = null;
  building.cooldownDays = null;
  refreshMarker(building);
  applyFilterToMarker(building);
  saveBuildings();
  updateStats();
};

window.deleteBuilding = function(id) {
  setBlockMapClick();
  map.closePopup();
  var marker = markers[id];
  if (marker) { map.removeLayer(marker); delete markers[id]; }
  buildings = buildings.filter(function(b) { return b.id !== id; });
  saveBuildings();
  updateStats();
};

window.addComment = function(id) {
  setBlockMapClick();
  var building = buildings.find(function(b) { return b.id === id; });
  if (!building) return;
  openCommentDialog(building.comment || '', function(text) {
    building.comment = text;
    refreshMarker(building);
    saveBuildings();
    map.closePopup();
  });
};

window.addTempComment = function() {
  setBlockMapClick();
  openCommentDialog(tempComment || '', function(text) {
    tempComment = text;
    if (tempMarker && tempComment) {
      tempMarker.closePopup();
    } else if (tempMarker) {
      var cls = 'marker-icon marker-temp';
      if (tempComment) cls += ' marker-has-comment';
      var size = isMobile ? 32 : 24;
      tempMarker.setIcon(L.divIcon({
        className: cls,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2]
      }));
      tempMarker.setPopupContent(getChoicePopupContent(
        tempMarker.getLatLng().lat, tempMarker.getLatLng().lng
      ));
    }
  });
};

function openCommentDialog(currentText, onSave) {
  var dialog = document.getElementById('comment-dialog');
  var textarea = document.getElementById('comment-textarea');
  textarea.value = currentText;
  dialog.classList.add('open');
  setTimeout(function() { textarea.focus(); }, 100);

  function save() {
    var text = textarea.value.trim();
    close();
    onSave(text || null);
  }

  function close() {
    dialog.classList.remove('open');
    document.getElementById('comment-save').onclick = null;
    document.getElementById('comment-cancel').onclick = null;
    textarea.onkeydown = null;
    dialog.onclick = null;
  }

  textarea.onkeydown = function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  };
  document.getElementById('comment-save').onclick = save;
  document.getElementById('comment-cancel').onclick = function() { close(); };
  dialog.onclick = function(e) {
    if (e.target === dialog) close();
  };
}

document.getElementById('cooldown-days').addEventListener('change', function() {
  saveSettings();
  refreshAllMarkers();
});

document.querySelectorAll('.btn-filter').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.btn-filter').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    currentFilter = this.dataset.filter;
    refreshAllMarkers();
  });
});

document.getElementById('btn-export').addEventListener('click', function() {
  var data = { buildings: buildings, settings: loadSettings(), exportedAt: new Date().toISOString() };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'flyer-map-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-import').addEventListener('click', function() {
  document.getElementById('file-import').click();
});

document.getElementById('file-import').addEventListener('change', function(e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    try {
      var data = JSON.parse(ev.target.result);
      if (data.buildings && Array.isArray(data.buildings)) {
        Object.values(markers).forEach(function(m) { map.removeLayer(m); });
        markers = {};
        buildings = data.buildings;
        buildings.forEach(function(b) {
          if (!b.status || b.status === 'pending') b.status = 'planned';
          if (b.excluded === undefined) b.excluded = false;
          if (b.comment === undefined) b.comment = null;
        });
        nextId = buildings.length > 0 ? Math.max.apply(null, buildings.map(function(b) { return b.id; })) + 1 : 1;
        buildings.forEach(function(b) { addMarkerToMap(b); });
        if (data.settings && data.settings.cooldownDays) {
          document.getElementById('cooldown-days').value = data.settings.cooldownDays;
        }
        saveBuildings();
        saveSettings();
        refreshAllMarkers();
        alert('Импортировано ' + buildings.length + ' домов');
      } else { alert('Неверный формат файла'); }
    } catch (err) { alert('Ошибка чтения файла: ' + err.message); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('btn-offline').addEventListener('click', function() {
  var bounds = map.getBounds();
  var minZoom = Math.max(map.getZoom() - 2, 0);
  var maxZoom = Math.min(map.getZoom() + 5, 19);
  var tiles = [];

  for (var z = minZoom; z <= maxZoom; z++) {
    var nw = latLngToTile(bounds.getNorthWest().lat, bounds.getNorthWest().lng, z);
    var se = latLngToTile(bounds.getSouthEast().lat, bounds.getSouthEast().lng, z);
    var x1 = Math.min(nw.x, se.x);
    var x2 = Math.max(nw.x, se.x);
    var y1 = Math.min(nw.y, se.y);
    var y2 = Math.max(nw.y, se.y);
    for (var x = x1; x <= x2; x++) {
      for (var y = y1; y <= y2; y++) {
        tiles.push('https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png');
      }
    }
  }

  var status = document.getElementById('offline-status');
  var count = tiles.length;
  if (count === 0) {
    status.textContent = 'Нет тайлов для сохранения';
    status.style.color = '#f39c12';
    return;
  }
  status.textContent = 'Сохраняю 0/' + count + ' тайлов...';
  status.style.color = '#ffd700';

  var loaded = 0;
  var failed = 0;
  var batchSize = 12;
  var index = 0;

  function processBatch() {
    var end = Math.min(index + batchSize, count);
    var promises = [];
    for (var i = index; i < end; i++) {
      promises.push(
        fetch(tiles[i]).then(function(r) {
          if (r.ok) loaded++; else failed++;
        }).catch(function() {
          failed++;
        })
      );
    }
    index = end;
    Promise.all(promises).then(function() {
      status.textContent = 'Сохраняю ' + (loaded + failed) + '/' + count + (failed > 0 ? ' (' + failed + ' ошибок)' : '') + '...';
      if (index < count) {
        setTimeout(processBatch, 50);
      } else {
        status.textContent = 'Сохранено: ' + loaded + ' тайлов' + (failed > 0 ? ' (' + failed + ' ошибок)' : '');
        status.style.color = '#2ecc71';
      }
    });
  }

  processBatch();
});

function latLngToTile(lat, lng, zoom) {
  var n = Math.pow(2, zoom);
  return {
    x: Math.floor((lng + 180) / 360 * n),
    y: Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)
  };
}

let listSort = 'address';
let listFilter = 'all';

document.getElementById('btn-list').addEventListener('click', openHouseList);
document.getElementById('list-close').addEventListener('click', closeHouseList);

document.querySelectorAll('.list-sort-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.list-sort-btn').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    listSort = this.dataset.sort;
    renderHouseList();
  });
});

document.querySelectorAll('#list-filters .btn-filter').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#list-filters .btn-filter').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    listFilter = this.dataset.filter;
    renderHouseList();
  });
});

function openHouseList() {
  if (isMobile && isSidebarOpen()) closeSidebar();
  document.getElementById('house-list').classList.add('open');
  renderHouseList();
}

function closeHouseList() {
  document.getElementById('house-list').classList.remove('open');
}

function renderHouseList() {
  var container = document.getElementById('house-list-content');
  var list = buildings.slice();

  var statusLabels = {
    planned: 'Обклеить',
    active: 'Обклеено',
    commented: 'Закомментировано',
    excluded: 'Исключён'
  };
  var dotClasses = {
    planned: 'dot-planned',
    active: 'dot-active',
    commented: 'dot-commented',
    excluded: 'dot-excluded'
  };

  if (listFilter !== 'all') {
    if (listFilter === 'commented') {
      list = list.filter(function(b) { return !!b.comment; });
    } else {
      list = list.filter(function(b) { return getStatus(b) === listFilter; });
    }
  }

  if (listSort === 'address') {
    list.sort(function(a, b) {
      var addrA = a.address || 'Дом #' + a.id;
      var addrB = b.address || 'Дом #' + b.id;
      return addrA.localeCompare(addrB, 'ru');
    });
  } else if (listSort === 'date') {
    list.sort(function(a, b) {
      var dateA = a.lastMarkedAt || a.createdAt || '';
      var dateB = b.lastMarkedAt || b.createdAt || '';
      return dateB.localeCompare(dateA);
    });
  } else if (listSort === 'status') {
    var order = { planned: 0, active: 1, commented: 2, excluded: 3 };
    list.sort(function(a, b) {
      return (order[getStatus(a)] || 99) - (order[getStatus(b)] || 99);
    });
  }

  if (list.length === 0) {
    container.innerHTML = '<div class="list-empty">Нет домов</div>';
    return;
  }

  var html = '';
  list.forEach(function(b) {
    var status = getStatus(b);
    var addr = b.address || 'Дом #' + b.id;
    var meta = '';
    var remaining = getRemainingText(b);
    if (remaining) meta += remaining;
    if (b.lastMarkedAt) {
      if (meta) meta += ' | ';
      meta += new Date(b.lastMarkedAt).toLocaleDateString('ru-RU');
    }

    html += '<div class="list-item" onclick="focusHouse(' + b.id + ')">';
    html += '<span class="list-item-dot ' + dotClasses[status] + '"></span>';
    html += '<div class="list-item-info">';
    html += '<div class="list-item-address">' + addr + '</div>';
    if (meta) {
      html += '<div class="list-item-meta">' + meta + '</div>';
    }
    html += '</div>';
    if (b.comment) {
      html += '<span class="list-item-comment">💬</span>';
    }
    html += '</div>';
  });

  container.innerHTML = html;
}

window.focusHouse = function(id) {
  closeHouseList();
  var marker = markers[id];
  if (!marker) return;
  map.setView(marker.getLatLng(), Math.max(map.getZoom(), 17));
  marker.openPopup();
};

setInterval(refreshAllMarkers, 60000);

document.getElementById('sidebar-toggle').addEventListener('click', function() {
  if (isSidebarOpen()) { closeSidebar(); } else { openSidebar(); }
});
document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

document.getElementById('btn-locate').addEventListener('click', function() {
  var btn = this;
  if (isTracking) { stopLocating(btn); return; }
  if (!map) return;
  locateAttempt = 0;
  map.locate({ setView: true, maxZoom: 17, watch: true, enableHighAccuracy: true });
  btn.classList.add('tracking');
  btn.textContent = '\u2715';
  isTracking = true;
});

function stopLocating(btn) {
  map.stopLocate();
  if (locationMarker) { map.removeLayer(locationMarker); locationMarker = null; }
  if (locationCircle) { map.removeLayer(locationCircle); locationCircle = null; }
  isTracking = false;
  btn.classList.remove('tracking', 'tracking-wifi');
  btn.textContent = '\u2316';
}

function showToast(msg) {
  var toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(function() { toast.classList.remove('show'); }, 4000);
}

initMap();
