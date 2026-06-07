# Состояние проекта: Map

_Обновлено: 2026-06-03_

## Кратко
PWA на чистом HTML/CSS/JS + Leaflet + OpenStreetMap. Карта города с маркерами домов. 4 статуса, таймер кд, комментарии с кастомным диалогом, геолокация (GPS + Wi-Fi fallback), поиск адресов через Nominatim, список домов с сортировкой, офлайн-кэширование тайлов. Развёрнуто на GitHub Pages.

## Стек и зависимости
- Фронтенд: Vanilla HTML + CSS + JavaScript (без сборки)
- Карта: Leaflet 1.9.4 (CDN, `tile.openstreetmap.org` — единый поддомен для кэша)
- Геокодинг: Nominatim (OSM) — обратный и прямой
- Хранение: localStorage
- PWA: manifest.json + Service Worker
- Хостинг: GitHub Pages

## Структура репозитория
- `index.html` — HTML, PWA-манифест, SW-регистрация, toast-уведомления, диалог комментариев, оверлей списка домов, поисковая строка
- `css/style.css` — тёмная тема, сайдбар-ящик, попапы, фильтры (цветные кнопки), список домов, диалог комментариев, поиск, toast
- `js/app.js` — ядро: карта, статусы, таймер, комментарии, геолокация, поиск, офлайн-кэш тайлов, список домов, экспорт/импорт
- `sw.js` — Service Worker: HTML сеть-first, CDN кэш-first, своё сеть-first, тайлы кэш-first (отдельный кэш TILE_CACHE)
- `manifest.json` — PWA-манифест
- `icons/` — 192×192 и 512×512

## Ключевые сущности

### Building (дом)
```js
{
  id: number,
  lat: number, lng: number,
  status: 'planned' | 'done' | 'excluded' | 'commented',
  excluded: boolean,
  cooldownDays: number | null,
  lastMarkedAt: string | null,
  address: string | null,
  comment: string | null,
  createdAt: string
}
```

### Вычисляемые статусы (`getStatus()`)
- `active` (🟢 зелёный) — status='done', таймер не истёк
- `planned` (🟠 оранжевый) — status='planned' или status='done' и таймер истёк
- `excluded` (⚪ серый) — excluded=true
- `commented` (🟣 фиолетовый) — status='commented'
- Индикатор комментария: золотая точка `::after` если есть `comment` или `status='commented'`
- Фильтр «Закомментировано» показывает ВСЕ дома с комментариями, а не только status='commented'

### Создание дома
1. Клик по карте → временный серый пунктирный маркер + карточка выбора
2. 💬 → кастомный диалог (автофокус, autocapitalize, Enter для сохранения)
3. Обклеить/Обклеено/Исключить → дом создаётся с выбранным статусом
4. Закрыть попап с комментарием → авто-сохранение со статусом 'commented'
5. Закрыть попап без комментария → маркер удаляется

### Действия в попапе
- `planBuilding(id)` — переводит в planned (Обклеить)
- `doneBuilding(id)` — ставит lastMarkedAt, запускает таймер (Обклеено)
- `excludeBuilding(id)` — excluded=true (Исключить)
- `deleteBuilding(id)` — удаляет без подтверждения
- `addComment(id)` — кастомный диалог, после сохранения попап закрывается

### Геолокация
- Два этапа: GPS (`enableHighAccuracy: true`) → при ошибке авто-фолбэк на Wi-Fi/вышки (`enableHighAccuracy: false`, жёлтая кнопка + toast)
- `initialViewSet` — карта центрируется только при первом определении, затем свободное перемещение
- locationPane z-index: 650 (выше markerPane: 600)

### Поиск
- Поле ввода видно когда геолокация выключена
- Прямой геокодинг через Nominatim (задержка 300мс)
- Фолбэк: поиск по отмеченным домам при отсутствии интернета
- Результаты: синяя точка (Nominatim) или цветная точка статуса (свой дом)

### Офлайн-тайлы
- Кнопка «Сохранить область»: загрузка тайлов текущего вьюпорта (zoom −2…+5) пачками по 12 с паузой 50мс
- SW: отдельный кэш `flyer-map-tiles-v1`, кэш-first для `tile.openstreetmap.org`
- Единый поддомен `tile.openstreetmap.org` (не {s}) для совпадения URL в кэше

## Точки входа
- Деплой: `git push` → GitHub Pages
- Локально: открыть `index.html`
- Телефон: https://altaisky.github.io/flyer-map/ → «На экран Домой»

## Состояние работы
- Стабильно: карта, 4 статуса, таймер, комментарии, поиск, список домов, геолокация с фолбэком, офлайн-тайлы
- Откачено: поворот карты (rotate/touchRotate) — `user-scalable=no` блокировал мультитач
- Известные проблемы: загрузка 5000+ тайлов замедляется после ~1500 (пачечный режим)

## Заметки
- ⚠ **НЕ использовать `...` в edit** — вставляется как литерал, ломает HTML
- `blockMapClick` с авто-сбросом 100мс — от всплытия кликов попапа в карту
- `tempComment` копируется в локальную переменную ДО `removeTempMarker()`
- SW: `updateViaCache: 'none'`, кэш `flyer-map-v41` + `flyer-map-tiles-v1`
- `setInterval(refreshAllMarkers, 60000)` — переход active→planned раз в минуту
