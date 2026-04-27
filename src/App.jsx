import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════
// STORAGE & UTILS
// ═══════════════════════════════════════════
const S = {
  get(k) { try { return JSON.parse(localStorage.getItem(`nyc_${k}`)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`nyc_${k}`, JSON.stringify(v)); } catch {} },
};

const HOME = { lat: 40.7282, lng: -74.0776 };

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distInfo(lat, lng, from) {
  const f = from || HOME;
  const m = haversine(f.lat, f.lng, lat, lng);
  return { km: (m / 1000).toFixed(1), walkMin: Math.round(m / 80), carMin: Math.max(5, Math.round(m / 500)), m: Math.round(m) };
}

function DistBadge({ lat, lng, gps, name }) {
  const d = distInfo(lat, lng, gps);
  const label = gps ? "📍" : "🏠";

  // Construye URLs de Google Maps
  const mapsView = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}${name ? `(${encodeURIComponent(name)})` : ""}`;
  const mapsDir = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}${gps ? `&origin=${gps.lat},${gps.lng}` : ""}`;

  // Estilo común para los botones de mapa
  const mapBtn = (color) => ({
    fontSize: 9, padding: "1px 5px", borderRadius: 4,
    background: `${color}15`, color: color,
    textDecoration: "none", cursor: "pointer",
    border: `1px solid ${color}30`,
    display: "inline-block",
  });

  // stopPropagation para que pulsar el botón no active el onClick del padre (ej: tarjetas plegables)
  const stop = (e) => e.stopPropagation();

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }} onClick={stop}>
      <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: `${C.blue}15`, color: C.blue }}>{label} {d.km}km</span>
      <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: `${C.gold}15`, color: C.gold }}>🚶{d.walkMin}min</span>
      <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: `${C.green}15`, color: C.green }}>🚕~{d.carMin}min</span>
      <a href={mapsView} target="_blank" rel="noopener noreferrer" onClick={stop} title="Ver en Google Maps" style={mapBtn(C.purple)}>📍 Mapa</a>
      <a href={mapsDir} target="_blank" rel="noopener noreferrer" onClick={stop} title="Cómo llegar con Google Maps" style={mapBtn(C.accent)}>🧭 Ir</a>
    </div>
  );
}

function useGPS() {
  const [pos, setPos] = useState(null);
  const [active, setActive] = useState(false);
  const w = useRef(null);
  const start = useCallback(() => {
    if (!navigator.geolocation) return;
    setActive(true);
    w.current = navigator.geolocation.watchPosition(p => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { enableHighAccuracy: true, maximumAge: 10000 });
  }, []);
  const stop = useCallback(() => { if (w.current) navigator.geolocation.clearWatch(w.current); setActive(false); setPos(null); }, []);
  return { pos, active, start, stop };
}

// Hook para tasa de cambio USD/EUR (con API principal + respaldo)
// API 1: frankfurter.dev (Banco Central Europeo, sin clave) - PRINCIPAL
// API 2: exchangerate-api.com (sin clave en endpoint open) - RESPALDO
function useExchangeRate() {
  const cached = S.get("fx") || null;
  // Fallback inicial: tasa razonable abril 2026 (~0.85)
  // Solo se usa si jamás hemos podido conectar a internet
  const [rate, setRate] = useState(cached?.rate || 0.85);
  const [updated, setUpdated] = useState(cached?.updated || null);
  const [source, setSource] = useState(cached?.source || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchRate = useCallback(async () => {
    setLoading(true);
    setError(false);

    // Intentar API principal: frankfurter.dev (Banco Central Europeo, datos oficiales)
    try {
      const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR");
      if (res.ok) {
        const data = await res.json();
        const newRate = data?.rates?.EUR;
        if (typeof newRate === "number" && newRate > 0.5 && newRate < 1.5) {
          const now = Date.now();
          setRate(newRate);
          setUpdated(now);
          setSource("BCE (Frankfurter)");
          S.set("fx", { rate: newRate, updated: now, source: "BCE (Frankfurter)" });
          setLoading(false);
          return;
        }
      }
    } catch (e) {
      // sigue al respaldo
    }

    // API de respaldo: exchangerate-api.com (formato JSON simple, sin clave)
    try {
      const res = await fetch("https://open.er-api.com/v6/latest/USD");
      if (res.ok) {
        const data = await res.json();
        const newRate = data?.rates?.EUR;
        if (typeof newRate === "number" && newRate > 0.5 && newRate < 1.5) {
          const now = Date.now();
          setRate(newRate);
          setUpdated(now);
          setSource("ExchangeRate-API");
          S.set("fx", { rate: newRate, updated: now, source: "ExchangeRate-API" });
          setLoading(false);
          return;
        }
      }
    } catch (e) {
      // ambos han fallado
    }

    setError(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    // refresca si nunca o si pasaron más de 6 horas
    const stale = !updated || (Date.now() - updated) > 6 * 3600 * 1000;
    if (stale) fetchRate();
  }, [fetchRate, updated]);

  return { rate, updated, source, loading, error, refresh: fetchRate };
}

// Hook para meteorología en Nueva York (API Open-Meteo, gratis sin clave)
function useWeather() {
  const cached = (typeof window !== "undefined" && JSON.parse(localStorage.getItem("nyc_weather") || "null")) || null;
  const [data, setData] = useState(cached?.data || null);
  const [updated, setUpdated] = useState(cached?.updated || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Coordenadas NY (Manhattan)
  const NYC_LAT = 40.7128;
  const NYC_LNG = -74.0060;

  const fetchWeather = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${NYC_LAT}&longitude=${NYC_LNG}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=America/New_York&forecast_days=6`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("API error");
      const json = await res.json();
      const now = Date.now();
      setData(json);
      setUpdated(now);
      try { localStorage.setItem("nyc_weather", JSON.stringify({ data: json, updated: now })); } catch {}
    } catch (e) {
      setError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Refresca si nunca o si pasaron más de 30 minutos
    const stale = !updated || (Date.now() - updated) > 30 * 60 * 1000;
    if (stale) fetchWeather();
  }, [fetchWeather, updated]);

  return { data, updated, loading, error, refresh: fetchWeather };
}

// Iconos según código WMO de Open-Meteo
function weatherIcon(code) {
  if (code === 0) return "☀️";          // despejado
  if (code <= 2) return "🌤️";           // mayormente despejado
  if (code === 3) return "☁️";           // nublado
  if (code <= 49) return "🌫️";           // niebla
  if (code <= 67) return "🌧️";           // lluvia
  if (code <= 77) return "❄️";           // nieve
  if (code <= 82) return "🌦️";           // chubascos
  if (code <= 86) return "🌨️";           // chubascos de nieve
  if (code <= 99) return "⛈️";           // tormenta
  return "🌡️";
}

function weatherDesc(code) {
  if (code === 0) return "Despejado";
  if (code <= 2) return "Mayormente despejado";
  if (code === 3) return "Nublado";
  if (code <= 49) return "Niebla";
  if (code <= 57) return "Llovizna";
  if (code <= 67) return "Lluvia";
  if (code <= 77) return "Nieve";
  if (code <= 82) return "Chubascos";
  if (code <= 86) return "Chubascos de nieve";
  if (code <= 99) return "Tormenta";
  return "—";
}

// Formatea hora de partido: "00:00+1" → { time: "00:00", nextDay: true }
function parseMatchTime(raw) {
  if (!raw) return { time: "—", nextDay: false };
  const nextDay = raw.includes("+1");
  const time = raw.replace("+1", "").trim();
  return { time, nextDay };
}

// Devuelve día abreviado siguiente al dado: "Lun" → "Mar"
const DOW_NEXT = { "Dom":"Lun", "Lun":"Mar", "Mar":"Mié", "Mié":"Jue", "Jue":"Vie", "Vie":"Sáb", "Sáb":"Dom" };
function nextDow(dow) {
  return DOW_NEXT[dow] || "+1";
}

// Hook para calidad del aire en NY (Open-Meteo Air Quality, gratis sin clave)
function useAirQuality() {
  const cached = (typeof window !== "undefined" && JSON.parse(localStorage.getItem("nyc_aqi") || "null")) || null;
  const [data, setData] = useState(cached?.data || null);
  const [updated, setUpdated] = useState(cached?.updated || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const NYC_LAT = 40.7128;
  const NYC_LNG = -74.0060;

  const fetchAQI = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${NYC_LAT}&longitude=${NYC_LNG}&current=us_aqi,pm2_5,pm10,ozone&timezone=America/New_York`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("API error");
      const json = await res.json();
      const now = Date.now();
      setData(json);
      setUpdated(now);
      try { localStorage.setItem("nyc_aqi", JSON.stringify({ data: json, updated: now })); } catch {}
    } catch (e) {
      setError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const stale = !updated || (Date.now() - updated) > 60 * 60 * 1000; // refresca cada hora
    if (stale) fetchAQI();
  }, [fetchAQI, updated]);

  return { data, updated, loading, error, refresh: fetchAQI };
}

// Helpers para AQI (US AQI scale)
function aqiInfo(aqi) {
  if (aqi == null) return { label: "—", color: "#7e8fa3", emoji: "🌫️", advice: "—" };
  if (aqi <= 50)  return { label: "Bueno",          color: "#22c55e", emoji: "🟢", advice: "Calidad excelente" };
  if (aqi <= 100) return { label: "Moderado",       color: "#fbbf24", emoji: "🟡", advice: "Aceptable para todos" };
  if (aqi <= 150) return { label: "Sensibles",      color: "#f97316", emoji: "🟠", advice: "Cuidado personas sensibles (mayores, niños)" };
  if (aqi <= 200) return { label: "Insalubre",      color: "#ef4444", emoji: "🔴", advice: "Limitar tiempo al aire libre" };
  if (aqi <= 300) return { label: "Muy insalubre",  color: "#a78bfa", emoji: "🟣", advice: "Evitar actividad al aire libre" };
  return                  { label: "Peligroso",     color: "#7c2d12", emoji: "⚫", advice: "Quedaos en interior" };
}

// Hook para estaciones de Citi Bike cercanas (gbfs.citibikenyc.com, gratis sin clave)
function useCitiBike(gps) {
  const [stations, setStations] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    if (!gps) return;
    setLoading(true);
    setError(false);
    try {
      // Necesitamos 2 endpoints: información de estaciones (nombre, ubicación) + estado (bicis disponibles)
      const [infoRes, statusRes] = await Promise.all([
        fetch("https://gbfs.citibikenyc.com/gbfs/en/station_information.json"),
        fetch("https://gbfs.citibikenyc.com/gbfs/en/station_status.json"),
      ]);
      if (!infoRes.ok || !statusRes.ok) throw new Error("API error");
      const info = await infoRes.json();
      const status = await statusRes.json();

      // Indexar status por id
      const statusMap = {};
      status.data.stations.forEach(s => { statusMap[s.station_id] = s; });

      // Combinar y calcular distancia
      const combined = info.data.stations
        .map(s => {
          const st = statusMap[s.station_id];
          if (!st || !st.is_installed || st.is_renting === false) return null;
          const distM = haversine(gps.lat, gps.lng, s.lat, s.lon);
          return {
            id: s.station_id,
            name: s.name,
            lat: s.lat,
            lng: s.lon,
            bikes: st.num_bikes_available || 0,
            ebikes: st.num_ebikes_available || 0,
            docks: st.num_docks_available || 0,
            distM,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.distM - b.distM)
        .slice(0, 5); // Top 5 cercanas

      setStations(combined);
    } catch (e) {
      setError(true);
    }
    setLoading(false);
  }, [gps]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { stations, loading, error, refresh: fetchData };
}

// Hook para calificaciones del NYC Health Dept (Socrata, gratis con throttling)
// Devuelve un objeto { "joe's pizza": "A", ... } indexado por nombre normalizado
function useRestaurantGrades() {
  const cached = (typeof window !== "undefined" && JSON.parse(localStorage.getItem("nyc_grades") || "null")) || null;
  const [grades, setGrades] = useState(cached?.grades || {});
  const [updated, setUpdated] = useState(cached?.updated || null);
  const [loading, setLoading] = useState(false);

  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const fetchGrades = useCallback(async (names) => {
    if (!names || names.length === 0) return;
    setLoading(true);
    try {
      // Intentamos buscar cada nombre. La API es: data.cityofnewyork.us/resource/43nn-pn8j.json
      // Solo recupero los que aún no tengo (cache)
      const result = { ...grades };
      for (const name of names) {
        const key = norm(name);
        if (result[key]) continue; // ya cacheado
        // Solo el primer nombre (sin las palabras cortas para mejor match)
        const firstWord = name.split(/\s+/).filter(w => w.length >= 3)[0] || name.split(/\s+/)[0];
        const q = encodeURIComponent(firstWord.toUpperCase());
        const url = `https://data.cityofnewyork.us/resource/43nn-pn8j.json?$select=dba,grade,inspection_date,boro&$where=upper(dba)%20like%20'%25${q}%25'%20AND%20grade%20IS%20NOT%20NULL&$order=inspection_date%20DESC&$limit=5`;
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const json = await res.json();
          // Buscar el match más cercano por nombre
          const match = json.find(r => norm(r.dba).includes(key.split(" ")[0]) || key.includes(norm(r.dba).split(" ")[0]));
          if (match && match.grade) {
            result[key] = match.grade;
          } else {
            result[key] = null; // marcar como buscado y no encontrado
          }
        } catch {
          result[key] = null;
        }
        // Pequeña pausa para no saturar la API sin token
        await new Promise(r => setTimeout(r, 200));
      }
      const now = Date.now();
      setGrades(result);
      setUpdated(now);
      try { localStorage.setItem("nyc_grades", JSON.stringify({ grades: result, updated: now })); } catch {}
    } catch (e) {
      // silencioso
    }
    setLoading(false);
  }, [grades]);

  // Función para obtener grade de un restaurante específico
  const getGrade = (name) => grades[norm(name)] || null;

  return { grades, getGrade, loading, fetchGrades, updated };
}

// ═══════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════
const C = {
  bg: "#0c1117", bg2: "#151d28", card: "#1a2433", hover: "#1f2d3d",
  accent: "#f97316", gold: "#fbbf24", red: "#ef4444", green: "#22c55e", blue: "#3b82f6", purple: "#a78bfa", pink: "#ec4899",
  text: "#e8edf3", muted: "#7e8fa3", border: "#243040",
};
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box" };

// ═══════════════════════════════════════════
// COMMON COMPONENTS
// ═══════════════════════════════════════════
const Card = ({ children, style, onClick }) => <div onClick={onClick} style={{ background: C.card, borderRadius: 12, padding: 14, marginBottom: 10, border: `1px solid ${C.border}`, ...(onClick ? { cursor: "pointer" } : {}), ...style }}>{children}</div>;
const Badge = ({ c, children }) => <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 16, fontSize: 10, fontWeight: 700, background: `${c}18`, color: c, border: `1px solid ${c}35` }}>{children}</span>;
const Title = ({ children, sub }) => <div style={{ marginBottom: 14 }}><div style={{ fontSize: 17, fontWeight: 800 }}>{children}</div>{sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}</div>;

// ═══════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════
const TRAVELERS = [
  { id: "javi",   name: "Javi",   age: 21, icon: "🧑", phone: "+34673321545", wa: true },
  { id: "rosa",   name: "Rosa",   age: 54, icon: "👩", phone: "+34637198949", wa: true },
  { id: "paz",    name: "Paz",    age: 70, icon: "👵", phone: "+34649849544", wa: true },
  { id: "viti",   name: "Viti",   age: 39, icon: "🧔", phone: "+34615239926", wa: true },
  { id: "miguel", name: "Miguel", age: 54, icon: "👨", phone: "+34607530565", wa: true },
];

// Grupo de WhatsApp del viaje
const GROUP_WHATSAPP_URL = "https://chat.whatsapp.com/GIg2GPCGhJA8dv2tXGsLlu";

// Mensajes rápidos pre-escritos
const QUICK_MESSAGES = [
  { icon: "⏰", text: "Llego en 10 minutos" },
  { icon: "📍", text: "¿Dónde estáis?" },
  { icon: "🍕", text: "¿Comemos juntos?" },
  { icon: "🚇", text: "Voy en camino" },
  { icon: "🤳", text: "Punto de encuentro: " },
  { icon: "✅", text: "Todo bien" },
];

const DAY_LABELS = ["20 Sáb","21 Dom","22 Lun","23 Mar","24 Mié","25 Jue","26 Vie","27 Sáb","28 Dom","29 Lun","30 Mar","1 Mié"];
const DAY_TITLES = ["✈️ Llegada","🗽 Downtown+🇪🇸","🏝️ Libertad+⚽","🌳 Park+MET","🏙️ Midtown","🌿 HighLine+⚽","🕊️ 9/11+🇪🇸","🎨 Museos+⚽","🌉 Brooklyn+🏳️‍🌈","🎷 Harlem","🏆 Compras+⚽","✈️ Vuelta"];

const DEFAULT_CAL = [
  { id:1, day:0, s:"12:25", e:"14:45", t:"✈️ Vuelo MAD→JFK", c:C.blue, f:true },
  { id:2, day:0, s:"15:30", e:"17:00", t:"🚕 JFK→Jersey City", c:C.blue },
  { id:3, day:0, s:"17:30", e:"19:00", t:"🏪 Supermercado", c:C.gold },
  { id:4, day:1, s:"09:00", e:"11:30", t:"🏦 Financial District+Oculus", c:C.accent, lat:40.7127, lng:-74.0134 },
  { id:5, day:1, s:"12:00", e:"14:00", t:"🇪🇸⚽ España vs Arabia Saudí (TV-Atlanta)", c:C.red },
  { id:6, day:1, s:"15:00", e:"17:00", t:"🌉 Puente Brooklyn", c:C.green, lat:40.7061, lng:-73.9969 },
  { id:7, day:1, s:"17:30", e:"20:00", t:"📸 DUMBO+cena Brooklyn", c:C.purple, lat:40.7033, lng:-73.9894 },
  { id:8, day:2, s:"08:30", e:"13:00", t:"🗽 Estatua Libertad+Ellis (4.5h)", c:C.accent, lat:40.6892, lng:-74.0445 },
  { id:9, day:2, s:"13:30", e:"15:00", t:"🍔 Comer Battery Park", c:C.gold, lat:40.7033, lng:-74.0170 },
  { id:10, day:2, s:"15:30", e:"18:00", t:"😴 Descanso Airbnb", c:C.muted },
  { id:11, day:2, s:"20:00", e:"22:30", t:"⚽ Noruega vs Senegal MetLife 🎟️", c:C.green, lat:40.8128, lng:-74.0742 },
  { id:12, day:3, s:"09:30", e:"12:30", t:"🌳 Central Park (3h)", c:C.green, lat:40.7712, lng:-73.9741 },
  { id:13, day:3, s:"13:00", e:"16:00", t:"🎨 Museo MET (3h)", c:C.purple, lat:40.7794, lng:-73.9632 },
  { id:14, day:3, s:"17:00", e:"20:00", t:"🍕 Upper West Side+cenar", c:C.gold, lat:40.7831, lng:-73.9712 },
  { id:15, day:4, s:"09:00", e:"12:00", t:"⭐ Times Sq+Rockefeller", c:C.accent, lat:40.7580, lng:-73.9855 },
  { id:16, day:4, s:"12:30", e:"14:00", t:"🍔 Hell's Kitchen", c:C.gold, lat:40.7638, lng:-73.9918 },
  { id:17, day:4, s:"14:30", e:"16:30", t:"🏙️ Top of the Rock (2h)", c:C.accent, lat:40.7587, lng:-73.9787 },
  { id:18, day:4, s:"17:00", e:"18:30", t:"📚 Bryant Park+Biblioteca", c:C.green, lat:40.7536, lng:-73.9832 },
  { id:19, day:4, s:"20:00", e:"22:30", t:"🎭 Broadway (opcional)", c:C.purple, lat:40.7590, lng:-73.9845 },
  { id:20, day:5, s:"09:00", e:"11:30", t:"🌿 High Line (2.5h)", c:C.green, lat:40.7480, lng:-74.0048 },
  { id:21, day:5, s:"11:30", e:"13:30", t:"🍕 Chelsea Market", c:C.gold, lat:40.7424, lng:-74.0061 },
  { id:22, day:5, s:"14:00", e:"15:30", t:"🏝️ Little Island", c:C.green, lat:40.7420, lng:-74.0103 },
  { id:23, day:5, s:"18:00", e:"20:30", t:"⚽ Ver fútbol Mundial en bar deportivo", c:C.green },
  { id:24, day:6, s:"09:00", e:"12:00", t:"🕊️ 9/11 Memorial+Museo (3h)", c:C.purple, lat:40.7115, lng:-74.0134 },
  { id:25, day:6, s:"12:30", e:"14:00", t:"🌐 One World Observatory (1.5h)", c:C.accent, lat:40.7127, lng:-74.0134 },
  { id:26, day:6, s:"14:30", e:"16:30", t:"🥟 Chinatown+Little Italy", c:C.gold, lat:40.7158, lng:-73.9970 },
  { id:27, day:6, s:"17:00", e:"19:00", t:"🛍️ SoHo", c:C.pink, lat:40.7233, lng:-73.9985 },
  { id:28, day:6, s:"20:00", e:"22:30", t:"🇪🇸⚽ Uruguay vs España (TV-Guadalajara 8pmET)", c:C.red },
  { id:29, day:7, s:"09:30", e:"12:00", t:"🎨 Guggenheim/MoMA (2.5h)", c:C.purple, lat:40.7830, lng:-73.9590 },
  { id:30, day:7, s:"12:30", e:"14:00", t:"🍔 Comer Midtown", c:C.gold },
  { id:31, day:7, s:"14:30", e:"16:30", t:"💎 5ª Avenida+Summit", c:C.accent, lat:40.7527, lng:-73.9772 },
  { id:32, day:7, s:"17:00", e:"19:30", t:"⚽ Panamá vs Inglaterra MetLife 5pmET 🎟️", c:C.green, lat:40.8128, lng:-74.0742 },
  { id:33, day:8, s:"10:00", e:"13:00", t:"🌉 Williamsburg+brunch", c:C.accent, lat:40.7081, lng:-73.9571 },
  { id:34, day:8, s:"13:30", e:"15:30", t:"📸 DUMBO+Jane's Carousel", c:C.green, lat:40.7033, lng:-73.9894 },
  { id:35, day:8, s:"16:00", e:"18:00", t:"🏳️‍🌈 NYC Pride March (5th Ave)", c:C.pink, lat:40.7448, lng:-73.9868 },
  { id:36, day:8, s:"18:30", e:"21:00", t:"🍕 Brooklyn Bridge Park+cenar", c:C.gold, lat:40.7002, lng:-73.9965 },
  { id:37, day:9, s:"10:00", e:"12:30", t:"🎷 Harlem: Apollo+Sylvia's", c:C.accent, lat:40.8100, lng:-73.9500 },
  { id:38, day:9, s:"13:00", e:"15:00", t:"🏛️ Columbia+Catedral", c:C.purple, lat:40.8075, lng:-73.9626 },
  { id:39, day:9, s:"16:00", e:"19:00", t:"🌳 Riverside Park+cenar UWS", c:C.green, lat:40.8020, lng:-73.9700 },
  { id:40, day:10, s:"09:30", e:"13:00", t:"🛍️ Compras: Times Sq+Macy's", c:C.pink, lat:40.7508, lng:-73.9890 },
  { id:41, day:10, s:"13:30", e:"16:00", t:"📸 Revisitar favoritos", c:C.accent },
  { id:42, day:10, s:"17:00", e:"19:30", t:"⚽ Eliminatoria Mundial MetLife 5pmET 🎟️", c:C.green, lat:40.8128, lng:-74.0742 },
  { id:43, day:10, s:"20:30", e:"22:00", t:"🧳 Maletas", c:C.muted },
  { id:44, day:11, s:"10:00", e:"10:30", t:"🏠 Check-out Airbnb", c:C.red, f:true },
  { id:45, day:11, s:"13:00", e:"14:30", t:"🚕 Ir a JFK", c:C.blue },
  { id:46, day:11, s:"16:45", e:"23:59", t:"✈️ Vuelo JFK→MAD", c:C.blue, f:true },
];

const RESTAURANTS = [
  { name:"Joe's Pizza", zone:"Greenwich Village", type:"🍕", price:"$", desc:"La pizza de NY. Porción $3-4", must:true, lat:40.7308, lng:-73.9973 },
  { name:"Los Tacos No. 1", zone:"Chelsea", type:"🌮", price:"$", desc:"Tacos auténticos mexicanos", must:true, lat:40.7424, lng:-74.0003 },
  { name:"Xi'an Famous Foods", zone:"Varias", type:"🍜", price:"$", desc:"Fideos tirados a mano", lat:40.7559, lng:-73.9888 },
  { name:"Katz's Deli", zone:"Lower East Side", type:"🥪", price:"$$", desc:"Pastrami legendario (When Harry met Sally)", must:true, lat:40.7223, lng:-73.9874 },
  { name:"Shake Shack", zone:"Madison Sq Park", type:"🍔", price:"$", desc:"Original en Madison Sq Park", lat:40.7408, lng:-73.9881 },
  { name:"Peter Luger", zone:"Williamsburg", type:"🥩", price:"$$$", desc:"Mejor carne de NY desde 1887", must:true, lat:40.7099, lng:-73.9624 },
  { name:"Prince St Pizza", zone:"NoLita", type:"🍕", price:"$", desc:"Pepperoni cuadrada viral", lat:40.7230, lng:-73.9946 },
  { name:"Levain Bakery", zone:"Upper West Side", type:"🍪", price:"$", desc:"Cookies gigantes famosas", must:true, lat:40.7799, lng:-73.9806 },
  { name:"Halal Guys", zone:"Midtown", type:"🥙", price:"$", desc:"Carrito icónico. Plato $8-10", lat:40.7618, lng:-73.9795 },
  { name:"Chelsea Market", zone:"Chelsea", type:"🏪", price:"$-$$", desc:"Mercado gourmet variado", lat:40.7424, lng:-74.0061 },
  { name:"Socarrat", zone:"Chelsea", type:"🇪🇸", price:"$$", desc:"Paella y tapas españolas", lat:40.7432, lng:-73.9979 },
  { name:"Bar Jamón", zone:"Gramercy", type:"🇪🇸", price:"$$", desc:"Jamón ibérico y vinos", lat:40.7383, lng:-73.9885 },
  { name:"Boqueria", zone:"Flatiron", type:"🇪🇸", price:"$$", desc:"Tapas estilo Barcelona", lat:40.7394, lng:-73.9906 },
  { name:"Wo Hop", zone:"Chinatown", type:"🥡", price:"$", desc:"Chino subterráneo desde 1938", lat:40.7151, lng:-73.9988 },
  { name:"Juliana's Pizza", zone:"DUMBO", type:"🍕", price:"$$", desc:"Del fundador de Grimaldi's", must:true, lat:40.7026, lng:-73.9934 },
  { name:"Russ & Daughters", zone:"Lower East Side", type:"🥯", price:"$", desc:"Bagels+salmón desde 1914", lat:40.7224, lng:-73.9882 },
  { name:"Smorgasburg", zone:"Williamsburg", type:"🏪", price:"$-$$", desc:"100+ puestos al aire libre. Domingos", lat:40.7216, lng:-73.9613 },
];

const MOVIES = [
  { title:"Home Alone 2", year:1992, type:"🎬", spots:[{n:"Plaza Hotel",lat:40.7645,lng:-73.9742},{n:"Rockefeller Center",lat:40.7587,lng:-73.9787},{n:"Central Park",lat:40.7712,lng:-73.9741}], tip:"Se puede entrar al lobby del Plaza" },
  { title:"Cuando Harry encontró a Sally", year:1989, type:"🎬", spots:[{n:"Katz's Delicatessen",lat:40.7223,lng:-73.9874}], tip:"La mesa de la escena tiene un cartel" },
  { title:"Friends", year:"1994-04", type:"📺", spots:[{n:"Apartamento (90 Bedford St)",lat:40.7321,lng:-74.0026}], tip:"Greenwich Village. Solo exterior" },
  { title:"Seinfeld", year:"1989-98", type:"📺", spots:[{n:"Tom's Restaurant (Monk's)",lat:40.8058,lng:-73.9653}], tip:"Se puede comer allí" },
  { title:"Desayuno con diamantes", year:1961, type:"🎬", spots:[{n:"Tiffany & Co, 5th Ave",lat:40.7623,lng:-73.9735}], tip:"La tienda original" },
  { title:"Spider-Man", year:2002, type:"🎬", spots:[{n:"Flatiron Building",lat:40.7411,lng:-73.9897}], tip:"El Flatiron sale en muchas pelis" },
  { title:"Cazafantasmas", year:1984, type:"🎬", spots:[{n:"Cuartel bomberos (Hook & Ladder 8)",lat:40.7191,lng:-74.0064}], tip:"14 N Moore St, TriBeCa" },
  { title:"Los Vengadores", year:2012, type:"🎬", spots:[{n:"Grand Central Terminal",lat:40.7527,lng:-73.9772},{n:"Stark Tower (MetLife)",lat:40.7532,lng:-73.9775}], tip:"Batalla final en Midtown" },
  { title:"King Kong", year:1933, type:"🎬", spots:[{n:"Empire State Building",lat:40.7484,lng:-73.9857}], tip:"Escena más icónica del cine" },
  { title:"Noche en el museo", year:2006, type:"🎬", spots:[{n:"Museo Hª Natural",lat:40.7813,lng:-73.9740}], tip:"El museo real. Imprescindible" },
  { title:"Sexo en Nueva York", year:"1998-04", type:"📺", spots:[{n:"Magnolia Bakery",lat:40.7365,lng:-74.0013}], tip:"Cupcakes en Bleecker St" },
  { title:"Gossip Girl", year:"2007-12", type:"📺", spots:[{n:"Escaleras del MET",lat:40.7794,lng:-73.9632}], tip:"Punto de encuentro Blair & Serena" },
  { title:"El diablo viste de Prada", year:2006, type:"🎬", spots:[{n:"Bryant Park / Midtown",lat:40.7536,lng:-73.9832}], tip:"Escenas por todo Midtown" },
  { title:"Soy leyenda", year:2007, type:"🎬", spots:[{n:"Washington Sq Park",lat:40.7308,lng:-73.9973},{n:"Puente Brooklyn",lat:40.7061,lng:-73.9969}], tip:"NY post-apocalíptico" },
  { title:"El Padrino", year:1972, type:"🎬", spots:[{n:"Little Italy / Mulberry St",lat:40.7191,lng:-73.9973}], tip:"Pasear e imaginar las escenas" },
  { title:"West Side Story", year:1961, type:"🎬", spots:[{n:"Lincoln Center",lat:40.7725,lng:-73.9835}], tip:"Zona demolida para Lincoln Center" },
  { title:"Elf", year:2003, type:"🎬", spots:[{n:"Rockefeller Center",lat:40.7587,lng:-73.9787}], tip:"Rockefeller central" },
  { title:"Taxi Driver", year:1976, type:"🎬", spots:[{n:"Times Square",lat:40.7580,lng:-73.9855}], tip:"El NY de los 70" },
  { title:"John Wick", year:2014, type:"🎬", spots:[{n:"Financial District",lat:40.7068,lng:-74.0090}], tip:"Varias localizaciones" },
  { title:"Stranger Things", year:"2016-25", type:"📺", spots:[{n:"Marquis Theatre (Broadway)",lat:40.7580,lng:-73.9862}], tip:"¡El musical está en Broadway durante el viaje!" },
];

const EVENTS = [
  { date:"20-30 Jun", cat:"🎭", name:"Hamilton", where:"Richard Rodgers Theatre", price:"desde $150", tip:"Hip-hop + historia. Imprescindible", lat:40.7590, lng:-73.9867 },
  { date:"20-30 Jun", cat:"🎭", name:"Wicked", where:"Gershwin Theatre", price:"desde $120", tip:"Ideal para toda la familia", lat:40.7622, lng:-73.9852 },
  { date:"20-30 Jun", cat:"🎭", name:"El Rey León", where:"Minskoff Theatre", price:"desde $90", tip:"Marionetas increíbles", lat:40.7577, lng:-73.9862 },
  { date:"20-30 Jun", cat:"🎭", name:"MJ The Musical", where:"Neil Simon Theatre", price:"desde $14", tip:"Michael Jackson. Baile increíble", lat:40.7605, lng:-73.9874 },
  { date:"20-30 Jun", cat:"🎭", name:"Stranger Things", where:"Marquis Theatre", price:"desde $70", tip:"Precuela con efectos especiales", lat:40.7580, lng:-73.9862 },
  { date:"20-30 Jun", cat:"🎭", name:"Chicago", where:"Ambassador Theatre", price:"desde $50", tip:"El más longevo de Broadway", lat:40.7596, lng:-73.9850 },
  { date:"20-30 Jun", cat:"🎭", name:"Moulin Rouge!", where:"Al Hirschfeld", price:"desde $80", tip:"Escenografía espectacular", lat:40.7592, lng:-73.9884 },
  { date:"28 Jun Dom", cat:"🏳️‍🌈", name:"NYC Pride March", where:"5th Ave → Greenwich Village", price:"Gratis", tip:"11AM. Millones de personas. Evento histórico", lat:40.7448, lng:-73.9868 },
  { date:"28 Jun Dom", cat:"🏳️‍🌈", name:"PrideFest", where:"Greenwich Village", price:"Gratis", tip:"Música, drag, comida. Tras el desfile", lat:40.7340, lng:-74.0027 },
  { date:"27 Jun Sáb", cat:"🏳️‍🌈", name:"Harlem Pride", where:"Harlem", price:"Gratis", tip:"Celebración con música y comida", lat:40.8116, lng:-73.9465 },
  { date:"20 Jun-1 Jul", cat:"⚾", name:"NY Yankees (MLB)", where:"Yankee Stadium, Bronx", price:"desde $20", tip:"Siempre hay partidos. Experiencia USA", lat:40.8296, lng:-73.9262 },
  { date:"20 Jun-1 Jul", cat:"⚾", name:"NY Mets (MLB)", where:"Citi Field, Queens", price:"desde $15", tip:"Más barato. Familiar", lat:40.7571, lng:-73.8458 },
  { date:"Jun-Jul", cat:"🎵", name:"SummerStage", where:"Central Park", price:"Gratis/variado", tip:"Conciertos al aire libre", lat:40.7709, lng:-73.9683 },
  { date:"Cada noche", cat:"🎵", name:"Jazz: Blue Note / Village Vanguard", where:"Greenwich Village", price:"desde $25", tip:"Clubs legendarios. Reservar", lat:40.7310, lng:-74.0005 },
  { date:"Cada noche", cat:"😂", name:"Comedy Cellar", where:"MacDougal St", price:"desde $15", tip:"Mejor comedia de NY", lat:40.7303, lng:-74.0004 },
];

// Categorías y SOS de la sección Documentos
const DOC_CATS = [
  { id:"flight",  l:"Vuelos",       icon:"✈️", c:C.blue },
  { id:"stay",    l:"Alojamiento",  icon:"🏠", c:C.gold },
  { id:"insur",   l:"Seguros",      icon:"🛡️", c:C.green },
  { id:"id",      l:"Identidad",    icon:"🛂", c:C.purple },
  { id:"wcup",    l:"Mundial",      icon:"⚽", c:C.red },
  { id:"other",   l:"Otros",        icon:"🎫", c:C.muted },
];

const SOS_PHONES = [
  { name:"Emergencias EE.UU.",          phone:"911",            note:"Policía, ambulancia, bomberos", c:C.red },
  { name:"Seguro IMAWAY (24h)",         phone:"+34 913 907 318", note:"Asistencia médica · Póliza 250002H5", c:C.green },
  { name:"Seguro IMAWAY (WhatsApp)",    phone:"+34 913 907 390", note:"Mensajes y consultas", c:C.green },
  { name:"Embajada España (Washington)",phone:"+1 202 452 0100", note:"Asistencia consular general", c:C.gold },
  { name:"Consulado España (NY)",       phone:"+1 212 355 4080", note:"150 E 58th St, Manhattan", c:C.gold },
  { name:"Iberia (USA)",                phone:"+1 800 772 4642", note:"Cambios y problemas con vuelos", c:C.blue },
];

// ═══════════════════════════════════════════
// 💱 CURRENCY CONVERTER (mini widget plegable)
// ═══════════════════════════════════════════
function CurrencyButton({ fx, open, onToggle }) {
  return (
    <button onClick={onToggle} title="Conversor de moneda" style={{
      padding:"6px 10px", borderRadius:8,
      border:`1px solid ${open ? C.gold : C.border}`,
      background: open ? `${C.gold}18` : "transparent",
      color: open ? C.gold : C.muted,
      fontSize:10, fontWeight:700, cursor:"pointer",
      whiteSpace:"nowrap"
    }}>
      💱 1$={fx.rate.toFixed(2)}€
    </button>
  );
}

function CurrencyPanel({ fx }) {
  const [amount, setAmount] = useState(100);
  const [direction, setDirection] = useState("usd_to_eur");

  const isUsdToEur = direction === "usd_to_eur";
  const result = isUsdToEur ? amount * fx.rate : amount / fx.rate;
  const fromSym = isUsdToEur ? "$" : "€";
  const toSym = isUsdToEur ? "€" : "$";
  const fromCol = isUsdToEur ? C.green : C.blue;
  const toCol = isUsdToEur ? C.blue : C.green;

  const minutesAgo = fx.updated ? Math.floor((Date.now() - fx.updated) / 60000) : null;
  const updatedText = !fx.updated ? "—" : minutesAgo < 1 ? "ahora" : minutesAgo < 60 ? `hace ${minutesAgo}min` : minutesAgo < 1440 ? `hace ${Math.floor(minutesAgo/60)}h` : `hace ${Math.floor(minutesAgo/1440)}d`;

  const quickAmounts = [5, 10, 20, 50, 100];

  return (
    <div style={{
      padding:"10px 14px 12px", background:`${C.gold}08`,
      borderBottom:`1px solid ${C.gold}30`
    }}>
      {/* Cabecera con info y refresh */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <div>
          <div style={{ fontSize:11, fontWeight:800, color:C.gold }}>💱 Conversor USD ↔ EUR</div>
          <div style={{ fontSize:9, color:C.muted, marginTop:1 }}>
            {fx.error
              ? "⚠️ Sin conexión a APIs · usando última tasa conocida"
              : <>1 USD = <b style={{ color:C.gold }}>{fx.rate.toFixed(4)} EUR</b> · {updatedText}{fx.source && ` · ${fx.source}`}</>
            }
          </div>
          {fx.updated && (Date.now() - fx.updated > 24 * 3600 * 1000) && (
            <div style={{ fontSize:9, color:C.red, marginTop:1 }}>
              ⚠️ Tasa con más de 24h, pulsa 🔄 para actualizar
            </div>
          )}
        </div>
        <button onClick={fx.refresh} disabled={fx.loading} style={{
          padding:"4px 8px", borderRadius:6, border:`1px solid ${C.border}`,
          background:"transparent", color:C.muted, fontSize:11, cursor:fx.loading?"default":"pointer",
          opacity:fx.loading?0.4:1
        }}>{fx.loading ? "⏳" : "🔄"}</button>
      </div>

      {/* Switch de dirección */}
      <div style={{ display:"flex", gap:4, marginBottom:8 }}>
        {[["usd_to_eur","🇺🇸 → 🇪🇺  $ a €"],["eur_to_usd","🇪🇺 → 🇺🇸  € a $"]].map(([k,l]) => (
          <button key={k} onClick={() => setDirection(k)} style={{
            flex:1, padding:"6px", borderRadius:7,
            border:`1px solid ${direction===k?C.gold:C.border}`,
            background:direction===k?`${C.gold}18`:"transparent",
            color:direction===k?C.gold:C.muted,
            fontSize:10, fontWeight:700, cursor:"pointer"
          }}>{l}</button>
        ))}
      </div>

      {/* Input + Resultado */}
      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:8 }}>
        <div style={{ flex:1, position:"relative" }}>
          <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", fontSize:14, fontWeight:800, color:fromCol }}>{fromSym}</span>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(parseFloat(e.target.value) || 0)}
            style={{ ...inputStyle, paddingLeft:26, fontSize:15, fontWeight:700, textAlign:"right" }}
          />
        </div>
        <span style={{ fontSize:18, color:C.muted }}>=</span>
        <div style={{ flex:1, padding:"10px 12px", borderRadius:10, border:`1px solid ${toCol}40`, background:`${toCol}10`, fontSize:15, fontWeight:800, color:toCol, textAlign:"right" }}>
          {toSym} {result.toFixed(2)}
        </div>
      </div>

      {/* Botones rápidos */}
      <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
        <span style={{ fontSize:9, color:C.muted, alignSelf:"center", marginRight:2 }}>Rápido:</span>
        {quickAmounts.map(a => (
          <button key={a} onClick={() => setAmount(a)} style={{
            padding:"4px 8px", borderRadius:14,
            border:`1px solid ${amount===a?fromCol:C.border}`,
            background:amount===a?`${fromCol}18`:"transparent",
            color:amount===a?fromCol:C.muted,
            fontSize:10, fontWeight:700, cursor:"pointer"
          }}>{fromSym}{a}</button>
        ))}
      </div>

      {/* Tip */}
      <div style={{ fontSize:9, color:C.muted, marginTop:8, fontStyle:"italic" }}>
        💡 Tasa de referencia (BCE). Tu banco aplicará una tasa similar +/- 0.5%
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// 🏠 HOME TAB (con sub-pestañas Hoy / Datos)
// ═══════════════════════════════════════════
const TRIP_START = new Date("2026-06-20T12:25:00+02:00");
const TRIP_END = new Date("2026-07-01T16:45:00-04:00");

function HomeTab({ setTab, gps }) {
  const [sub, setSub] = useState("today");

  return (
    <div>
      {/* Sub-pestañas */}
      <div style={{ display:"flex", gap:4, padding:"10px 14px 6px", background:C.bg2 }}>
        {[["today","📍 Hoy"],["data","🎫 Datos del viaje"]].map(([k,l]) => (
          <button key={k} onClick={() => setSub(k)} style={{
            flex:1, padding:"7px", borderRadius:8,
            border:`1px solid ${sub===k?C.accent:C.border}`,
            background:sub===k?`${C.accent}18`:"transparent",
            color:sub===k?C.accent:C.muted,
            fontSize:11, fontWeight:700, cursor:"pointer"
          }}>{l}</button>
        ))}
      </div>

      <div style={{ padding:"12px 14px" }}>
        {sub === "today" && <HomeToday setTab={setTab} gps={gps} />}
        {sub === "data" && <HomeData />}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// HOME · Hoy (panel dinámico)
// ───────────────────────────────────────────
function HomeToday({ setTab, gps }) {
  const weather = useWeather();
  const airQ = useAirQuality();
  const citiBike = useCitiBike(gps);
  const now = new Date();
  const tripStarted = now >= TRIP_START;
  const tripEnded = now > TRIP_END;
  const days = Math.max(0, Math.floor((TRIP_START - now) / 864e5));

  // Determinar el "día activo" del viaje
  // Si no ha empezado: día 0 (llegada). Si ya empezó: día actual del viaje (índice 0..11)
  let activeDayIdx = 0;
  if (tripStarted && !tripEnded) {
    const elapsed = Math.floor((now - TRIP_START) / 864e5);
    activeDayIdx = Math.min(11, Math.max(0, elapsed));
  }

  // Plan del día (eventos del calendario para activeDayIdx)
  // Leemos los eventos guardados en localStorage o defaults
  const events = (S.get("cal2") || DEFAULT_CAL).filter(ev => ev.day === activeDayIdx).sort((a,b) => a.s.localeCompare(b.s));

  // Partidos del día — calculamos qué fecha "real" mirar
  // Si el viaje no ha empezado, mostramos partidos del día 1 (20 Jun) para que se vea algo útil
  const dayLabelForMatches = WC_DAYS[activeDayIdx] || WC_DAYS[0];
  const matchesOfDay = WC_MATCHES.filter(m => m.d === dayLabelForMatches);

  // Próximo partido si no hay hoy
  const nextMatch = WC_MATCHES.find(m => true); // primer partido (20 Jun)

  return (
    <>
      {/* COUNTDOWN HERO */}
      {!tripStarted ? (
        <Card style={{ background:`linear-gradient(135deg, ${C.accent}15, ${C.gold}10)`, border:`1.5px solid ${C.accent}40`, textAlign:"center" }}>
          <div style={{ fontSize:9, color:C.muted, letterSpacing:2 }}>FALTAN</div>
          <div style={{ fontSize:48, fontWeight:900, color:C.accent, lineHeight:1, margin:"4px 0" }}>{days}</div>
          <div style={{ fontSize:12, fontWeight:700, color:C.gold, letterSpacing:1 }}>DÍAS PARA NUEVA YORK 🗽</div>
          <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>20 jun — 1 jul · 5 viajeros · 11 noches</div>
        </Card>
      ) : !tripEnded ? (
        <Card style={{ background:`linear-gradient(135deg, ${C.green}15, ${C.gold}10)`, border:`1.5px solid ${C.green}40`, textAlign:"center" }}>
          <div style={{ fontSize:9, color:C.muted, letterSpacing:2 }}>VIAJE EN CURSO</div>
          <div style={{ fontSize:32, fontWeight:900, color:C.green, lineHeight:1, margin:"4px 0" }}>DÍA {activeDayIdx + 1}/12</div>
          <div style={{ fontSize:13, fontWeight:700, color:C.gold }}>{DAY_TITLES[activeDayIdx]}</div>
          <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>{DAY_LABELS[activeDayIdx]} · 🗽 Disfrutad NY</div>
        </Card>
      ) : (
        <Card style={{ textAlign:"center" }}>
          <div style={{ fontSize:14, fontWeight:700 }}>🏁 Viaje completado</div>
          <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>¡Esperamos que disfrutarais Nueva York!</div>
        </Card>
      )}

      {/* TIEMPO EN NY */}
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div style={{ fontSize:13, fontWeight:800 }}>🌆 Tiempo en Nueva York</div>
          <button onClick={weather.refresh} disabled={weather.loading} style={{
            padding:"3px 8px", borderRadius:6, border:`1px solid ${C.border}`,
            background:"transparent", color:C.muted, fontSize:11,
            cursor:weather.loading?"default":"pointer", opacity:weather.loading?0.4:1
          }}>{weather.loading ? "⏳" : "🔄"}</button>
        </div>

        {weather.error && !weather.data && (
          <div style={{ fontSize:11, color:C.red, padding:8 }}>⚠️ No se ha podido cargar el tiempo</div>
        )}

        {!weather.data && weather.loading && (
          <div style={{ fontSize:11, color:C.muted, padding:8, textAlign:"center" }}>Cargando tiempo...</div>
        )}

        {weather.data && (() => {
          const cur = weather.data.current;
          const daily = weather.data.daily;
          return (
            <>
              {/* Tiempo actual */}
              <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:10 }}>
                <div style={{ fontSize:48, lineHeight:1 }}>{weatherIcon(cur.weather_code)}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:32, fontWeight:900, color:C.gold, lineHeight:1 }}>{Math.round(cur.temperature_2m)}°<span style={{ fontSize:18 }}>C</span></div>
                  <div style={{ fontSize:11, color:C.muted }}>{weatherDesc(cur.weather_code)}</div>
                  <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>
                    Sensación {Math.round(cur.apparent_temperature)}° · 💧{cur.relative_humidity_2m}% · 💨{Math.round(cur.wind_speed_10m)}km/h
                  </div>
                </div>
              </div>

              {/* Predicción 5 días */}
              <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:8 }}>
                <div style={{ fontSize:9, color:C.muted, marginBottom:6, letterSpacing:1 }}>PRÓXIMOS DÍAS</div>
                <div style={{ display:"flex", gap:4, justifyContent:"space-between" }}>
                  {daily.time.slice(1, 6).map((d, i) => {
                    const date = new Date(d);
                    const dayName = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"][date.getDay()];
                    const code = daily.weather_code[i + 1];
                    const max = daily.temperature_2m_max[i + 1];
                    const min = daily.temperature_2m_min[i + 1];
                    const rain = daily.precipitation_probability_max[i + 1];
                    return (
                      <div key={i} style={{ flex:1, textAlign:"center", padding:"5px 2px", background:C.bg, borderRadius:6 }}>
                        <div style={{ fontSize:9, color:C.muted, fontWeight:700 }}>{dayName}</div>
                        <div style={{ fontSize:18 }}>{weatherIcon(code)}</div>
                        <div style={{ fontSize:10, fontWeight:700, color:C.gold }}>{Math.round(max)}°</div>
                        <div style={{ fontSize:9, color:C.muted }}>{Math.round(min)}°</div>
                        {rain >= 30 && <div style={{ fontSize:8, color:C.blue }}>💧{rain}%</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          );
        })()}
      </Card>

      {/* PARTIDOS DEL DÍA */}
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontSize:13, fontWeight:800 }}>⚽ Mundial · {tripStarted ? `Día ${activeDayIdx + 1}` : "Día 1 (20 Jun)"}</div>
          <button onClick={() => setTab("wc")} style={{
            fontSize:9, color:C.accent, background:"transparent",
            border:`1px solid ${C.accent}40`, borderRadius:12, padding:"2px 8px", cursor:"pointer"
          }}>Ver todos</button>
        </div>

        {matchesOfDay.length === 0 ? (
          <div style={{ fontSize:11, color:C.muted, padding:6 }}>Sin partidos este día</div>
        ) : (
          matchesOfDay.slice(0, 4).map((m,i) => {
            const isSp = m.sp;
            const isMl = m.ml;
            const usT = parseMatchTime(m.h);
            const espT = parseMatchTime(m.esp);
            const usDayLabel = usT.nextDay ? ` ${nextDow(m.dow)}` : "";
            const espDayLabel = espT.nextDay ? ` ${nextDow(m.dow)}` : "";
            return (
              <div key={i} style={{
                display:"flex", alignItems:"center", gap:8, padding:"7px 8px", marginBottom:3,
                background:isSp?`${C.red}10`:isMl?`${C.green}08`:`${C.bg}`,
                borderRadius:6, borderLeft:`3px solid ${isSp?C.red:isMl?C.green:C.border}`
              }}>
                <div style={{ minWidth:54, textAlign:"center" }}>
                  <div style={{ fontSize:13, fontWeight:800, color:isSp?C.gold:isMl?C.green:C.accent, lineHeight:1.1 }}>
                    {usT.time}{usDayLabel}
                  </div>
                  <div style={{ fontSize:7, fontWeight:700, color:C.muted, marginTop:1 }}>🇺🇸 NY</div>
                  <div style={{ fontSize:8, color:C.muted, marginTop:2 }}>🇪🇸 {espT.time}{espDayLabel}</div>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:10, fontWeight:isSp||isMl?800:600, color:isSp?C.gold:C.text, overflow:"hidden", textOverflow:"ellipsis" }}>
                    {m.a} <span style={{ color:C.muted, fontSize:8 }}>vs</span> {m.b}
                  </div>
                  <div style={{ fontSize:8, color:C.muted }}>📍 {m.v}</div>
                </div>
                {isMl && <Badge c={C.green}>🎟️</Badge>}
                {isSp && <Badge c={C.red}>📺</Badge>}
              </div>
            );
          })
        )}
      </Card>

      {/* CALIDAD DEL AIRE */}
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontSize:13, fontWeight:800 }}>💨 Calidad del aire</div>
          <button onClick={airQ.refresh} disabled={airQ.loading} style={{
            padding:"3px 8px", borderRadius:6, border:`1px solid ${C.border}`,
            background:"transparent", color:C.muted, fontSize:11,
            cursor:airQ.loading?"default":"pointer", opacity:airQ.loading?0.4:1
          }}>{airQ.loading ? "⏳" : "🔄"}</button>
        </div>

        {airQ.error && !airQ.data && (
          <div style={{ fontSize:11, color:C.red, padding:6 }}>⚠️ Sin datos de calidad del aire</div>
        )}

        {airQ.data && (() => {
          const cur = airQ.data.current;
          const aqi = cur?.us_aqi != null ? Math.round(cur.us_aqi) : null;
          const info = aqiInfo(aqi);
          return (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                <div style={{ fontSize:36, lineHeight:1 }}>{info.emoji}</div>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                    <div style={{ fontSize:28, fontWeight:900, color:info.color, lineHeight:1 }}>{aqi ?? "—"}</div>
                    <div style={{ fontSize:11, fontWeight:700, color:info.color }}>{info.label}</div>
                  </div>
                  <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>{info.advice}</div>
                  <div style={{ fontSize:9, color:C.muted, marginTop:2 }}>
                    {cur.pm2_5 != null && <>PM2.5: {Math.round(cur.pm2_5)} </>}
                    {cur.pm10 != null && <>· PM10: {Math.round(cur.pm10)} </>}
                    {cur.ozone != null && <>· O₃: {Math.round(cur.ozone)}</>}
                  </div>
                </div>
              </div>
              {aqi >= 100 && (
                <div style={{ marginTop:8, padding:"6px 8px", background:`${info.color}15`, borderRadius:6, fontSize:10, color:info.color }}>
                  ⚠️ Atención especial para Paz (mayor de 65). Considerar paseos cortos o interiores.
                </div>
              )}
            </div>
          );
        })()}
      </Card>

      {/* CITI BIKE — solo si GPS activo */}
      {gps && (
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
            <div style={{ fontSize:13, fontWeight:800 }}>🚲 Citi Bike cerca</div>
            <button onClick={citiBike.refresh} disabled={citiBike.loading} style={{
              padding:"3px 8px", borderRadius:6, border:`1px solid ${C.border}`,
              background:"transparent", color:C.muted, fontSize:11,
              cursor:citiBike.loading?"default":"pointer", opacity:citiBike.loading?0.4:1
            }}>{citiBike.loading ? "⏳" : "🔄"}</button>
          </div>

          {citiBike.error && (
            <div style={{ fontSize:11, color:C.red, padding:6 }}>⚠️ No se pudo cargar Citi Bike</div>
          )}

          {!citiBike.stations && !citiBike.error && (
            <div style={{ fontSize:11, color:C.muted, padding:6, textAlign:"center" }}>Buscando estaciones cercanas...</div>
          )}

          {citiBike.stations && citiBike.stations.length === 0 && (
            <div style={{ fontSize:11, color:C.muted, padding:6 }}>No hay estaciones disponibles cerca</div>
          )}

          {citiBike.stations && citiBike.stations.length > 0 && (
            <>
              {citiBike.stations.map(s => {
                const distKm = (s.distM / 1000).toFixed(1);
                const walkMin = Math.round(s.distM / 80);
                return (
                  <div key={s.id} style={{
                    display:"flex", alignItems:"center", gap:8,
                    padding:"6px 8px", marginBottom:3,
                    background:C.bg, borderRadius:6,
                    borderLeft:`3px solid ${s.bikes > 0 ? C.green : C.muted}`
                  }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.name}</div>
                      <div style={{ fontSize:9, color:C.muted }}>📍 {distKm}km · 🚶{walkMin}min</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:14, fontWeight:800, color:s.bikes > 0 ? C.green : C.muted }}>🚲 {s.bikes}</div>
                      {s.ebikes > 0 && <div style={{ fontSize:8, color:C.gold }}>⚡ {s.ebikes} eléctricas</div>}
                      <div style={{ fontSize:8, color:C.muted }}>🅿️ {s.docks} libres</div>
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize:9, color:C.muted, marginTop:6, textAlign:"center" }}>
                Día único $5 · Pase 24h $19 · 30min ilimitados
              </div>
            </>
          )}
        </Card>
      )}

      {/* PLAN DEL DÍA */}
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontSize:13, fontWeight:800 }}>📅 {tripStarted ? "Plan de hoy" : "Plan del día 1 (llegada)"}</div>
          <button onClick={() => setTab("cal")} style={{
            fontSize:9, color:C.accent, background:"transparent",
            border:`1px solid ${C.accent}40`, borderRadius:12, padding:"2px 8px", cursor:"pointer"
          }}>Ver calendario</button>
        </div>
        <div style={{ fontSize:11, color:C.muted, marginBottom:6 }}>{DAY_TITLES[activeDayIdx]} · {DAY_LABELS[activeDayIdx]}</div>

        {events.length === 0 ? (
          <div style={{ fontSize:11, color:C.muted, padding:6 }}>Sin eventos planificados</div>
        ) : (
          events.slice(0, 5).map((ev,i) => (
            <div key={i} style={{ display:"flex", gap:8, padding:"4px 0", borderBottom: i < Math.min(4, events.length - 1) ? `1px solid ${C.border}` : "none" }}>
              <div style={{ minWidth:42, fontSize:11, fontWeight:700, color:ev.c||C.accent }}>{ev.s}</div>
              <div style={{ flex:1, fontSize:11 }}>{ev.t}</div>
            </div>
          ))
        )}
        {events.length > 5 && (
          <div style={{ fontSize:9, color:C.muted, textAlign:"center", marginTop:6 }}>+ {events.length - 5} eventos más en el calendario</div>
        )}
      </Card>

      {/* ACCESOS RÁPIDOS */}
      <Card>
        <div style={{ fontSize:13, fontWeight:800, marginBottom:8 }}>⚡ Accesos rápidos</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
          <button onClick={() => setTab("ctrl")} style={{
            padding:"10px 8px", borderRadius:8, border:`1px solid ${C.green}40`,
            background:`${C.green}10`, color:C.green, fontSize:11, fontWeight:700, cursor:"pointer"
          }}>💬 Grupo / SOS</button>
          <button onClick={() => setTab("food")} style={{
            padding:"10px 8px", borderRadius:8, border:`1px solid ${C.gold}40`,
            background:`${C.gold}10`, color:C.gold, fontSize:11, fontWeight:700, cursor:"pointer"
          }}>🍕 Restaurantes</button>
          <button onClick={() => setTab("ai")} style={{
            padding:"10px 8px", borderRadius:8, border:`1px solid ${C.purple}40`,
            background:`${C.purple}10`, color:C.purple, fontSize:11, fontWeight:700, cursor:"pointer"
          }}>🤖 Guía IA</button>
          <button onClick={() => setTab("ctrl")} style={{
            padding:"10px 8px", borderRadius:8, border:`1px solid ${C.accent}40`,
            background:`${C.accent}10`, color:C.accent, fontSize:11, fontWeight:700, cursor:"pointer"
          }}>💰 Gastos</button>
        </div>
      </Card>
    </>
  );
}

// ───────────────────────────────────────────
// HOME · Datos del viaje (info administrativa)
// ───────────────────────────────────────────
function HomeData() {
  return (
    <>
      <Card>
        <div style={{ fontSize:14, fontWeight:700, marginBottom:6 }}>✈️ Vuelos · <span style={{ color:C.accent }}>KRLGF</span></div>
        {[["IDA — 20 JUN","IB0211: MAD → JFK","Sale 12:25 · Llega 14:45 T8",C.blue],["VUELTA — 01 JUL","IB0212: JFK → MAD","Sale 16:45 T8 · Llega 02 JUL 06:00",C.accent]].map(([t,r,d,c],i)=>(
          <div key={i} style={{ background:`${c}08`, borderRadius:8, padding:10, marginBottom:i===0?6:0, border:`1px solid ${c}18` }}>
            <div style={{ fontSize:10, fontWeight:700, color:c }}>{t}</div>
            <div style={{ fontSize:13, fontWeight:600, marginTop:1 }}>{r}</div>
            <div style={{ fontSize:11, color:C.muted }}>{d}</div>
          </div>
        ))}
      </Card>
      <Card>
        <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>🏠 Airbnb · Jersey City</div>
        <div style={{ fontSize:13 }}>65 Corbin Ave, NJ 07306</div>
        <div style={{ fontSize:11, color:C.muted }}>Anfitrión: Faria · Check-out: 1 jul 10:00</div>
        <div style={{ fontSize:11, padding:"3px 7px", background:`${C.gold}12`, borderRadius:6, color:C.gold, marginTop:4, display:"inline-block" }}>🚇 PATH: Journal Sq → Manhattan ~20 min</div>
        <DistBadge lat={HOME.lat} lng={HOME.lng} name="Airbnb 65 Corbin Ave Jersey City" />
      </Card>
      <Card>
        <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>🛡️ Seguro IMAWAY · 250002H5</div>
        <div style={{ fontSize:12, color:C.muted }}>Médico: <b style={{color:C.green}}>6M €</b> · Anulación: <b>5.000 €</b> · Total: <b>392,87 €</b></div>
        <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>📞 +34 913907318 · 💬 WA: 913907390</div>
      </Card>
      <Card>
        <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>💡 Imprescindible</div>
        <div style={{ fontSize:12, color:C.muted, lineHeight:1.7 }}>
          🛂 <b style={{color:C.text}}>ESTA:</b> 14$/persona · 🔌 <b style={{color:C.text}}>Enchufe:</b> Tipo A/B<br/>
          💳 <b style={{color:C.text}}>Revolut/N26</b> sin comisiones · Propina 15-20%<br/>
          🚇 <b style={{color:C.text}}>MetroCard 7 días:</b> $34 · 🌡️ 25-32°C + humedad
        </div>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════
// 📅 CALENDAR TAB (EDITABLE + IDEAS)
// ═══════════════════════════════════════════
function CalendarTab({ gps }) {
  const [events, setEvents] = useState(() => S.get("cal2") || DEFAULT_CAL);
  const [ideas, setIdeas] = useState(() => S.get("ideas") || []);
  const [day, setDay] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ t:"", s:"09:00", e:"11:00", c:C.accent });
  const [moving, setMoving] = useState(null);
  const [showIdeas, setShowIdeas] = useState(false);
  const [ideaText, setIdeaText] = useState("");
  const [scheduleIdea, setScheduleIdea] = useState(null);

  useEffect(() => { S.set("cal2", events); }, [events]);
  useEffect(() => { S.set("ideas", ideas); }, [ideas]);

  const dayEvt = events.filter(ev => ev.day === day).sort((a,b) => a.s.localeCompare(b.s));
  const nextId = Math.max(0, ...events.map(ev => ev.id), ...ideas.map(x => x.id || 0)) + 1;
  const overlap = (s, e, skip) => dayEvt.some(ev => ev.id !== skip && s < ev.e && e > ev.s);

  const save = () => {
    if (!form.t.trim()) return;
    if (editing !== null) {
      setEvents(events.map(ev => ev.id === editing ? { ...ev, t:form.t, s:form.s, e:form.e, c:form.c } : ev));
      setEditing(null);
    } else {
      setEvents([...events, { ...form, id:nextId, day }]);
    }
    setForm({ t:"", s:"09:00", e:"11:00", c:C.accent });
    setAdding(false);
  };

  const startEdit = (ev) => {
    if (ev.f) return;
    setMoving(null);
    setForm({ t:ev.t, s:ev.s, e:ev.e, c:ev.c||C.accent });
    setEditing(ev.id);
    setAdding(true);
  };

  const cancel = () => { setAdding(false); setEditing(null); setForm({ t:"", s:"09:00", e:"11:00", c:C.accent }); };

  const moveToDay = (evId, targetDay) => {
    setEvents(events.map(ev => ev.id === evId ? { ...ev, day: targetDay } : ev));
    setMoving(null);
  };

  const sendToIdeas = (ev) => {
    setIdeas([...ideas, { id: nextId, t: ev.t, c: ev.c || C.accent, from: DAY_LABELS[ev.day] }]);
    setEvents(events.filter(x => x.id !== ev.id));
  };

  const scheduleIdeaToDay = (ideaIdx, targetDay) => {
    const idea = ideas[ideaIdx];
    setEvents([...events, { id: nextId, day: targetDay, t: idea.t, s:"10:00", e:"11:30", c: idea.c || C.gold }]);
    setIdeas(ideas.filter((_, i) => i !== ideaIdx));
    setScheduleIdea(null);
  };

  const addIdea = () => {
    if (!ideaText.trim()) return;
    setIdeas([...ideas, { id: nextId, t: ideaText.trim(), c: C.gold }]);
    setIdeaText("");
  };

  const duration = (s, e) => {
    const [sh,sm] = s.split(":").map(Number);
    const [eh,em] = e.split(":").map(Number);
    return (eh*60+em) - (sh*60+sm);
  };

  return (
    <div style={{ padding: "12px 14px" }}>
      <Title sub="Toca para editar · 📦 mover día · 💡 ideas pendientes">📅 Calendario editable</Title>

      <div style={{ display:"flex", gap:3, overflowX:"auto", paddingBottom:8, marginBottom:8 }}>
        {DAY_LABELS.map((d,i) => {
          const hasEvts = events.some(ev => ev.day === i);
          return (
            <button key={i} onClick={() => { setDay(i); setMoving(null); }} style={{ padding:"5px 8px", borderRadius:7, border:`1px solid ${day===i?C.accent:C.border}`, background:day===i?`${C.accent}18`:"transparent", color:day===i?C.accent:C.muted, fontSize:10, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0, position:"relative" }}>
              {d}
              {hasEvts && <span style={{ position:"absolute", top:-2, right:-2, width:5, height:5, borderRadius:"50%", background:C.accent }} />}
            </button>
          );
        })}
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ fontSize:15, fontWeight:800 }}>{DAY_TITLES[day]} · {DAY_LABELS[day]}</div>
        <button onClick={() => setShowIdeas(!showIdeas)} style={{
          padding:"4px 10px", borderRadius:14, fontSize:10, fontWeight:700, cursor:"pointer",
          border:`1px solid ${C.gold}50`, background:showIdeas?`${C.gold}20`:`${C.gold}08`,
          color:C.gold, position:"relative"
        }}>
          💡 Ideas {ideas.length > 0 && <span style={{ background:C.gold, color:"#000", borderRadius:8, padding:"0 5px", fontSize:9, fontWeight:800, marginLeft:3 }}>{ideas.length}</span>}
        </button>
      </div>

      {showIdeas && (
        <Card style={{ borderColor:`${C.gold}40`, marginBottom:10, background:`${C.gold}06` }}>
          <div style={{ fontSize:12, fontWeight:800, color:C.gold, marginBottom:6 }}>💡 Ideas y Pendientes</div>
          <div style={{ fontSize:10, color:C.muted, marginBottom:8 }}>Apunta cosas que te interesen. Cuando tengas hueco, muévelas a un día.</div>

          {ideas.length === 0 && <div style={{ fontSize:11, color:C.muted, textAlign:"center", padding:12 }}>Sin ideas todavía. ¡Apunta lo que descubras!</div>}

          {ideas.map((idea, idx) => (
            <div key={idx} style={{ marginBottom:4 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 8px", background:C.card, borderRadius:6, borderLeft:`3px solid ${idea.c||C.gold}` }}>
                <span style={{ fontSize:12, flex:1 }}>{idea.t}</span>
                {idea.from && <span style={{ fontSize:8, color:C.muted }}>de {idea.from}</span>}
                <button onClick={() => setScheduleIdea(scheduleIdea === idx ? null : idx)} title="Programar" style={{ background:"none", border:"none", fontSize:13, cursor:"pointer", padding:"0 2px" }}>📅</button>
                <button onClick={() => setIdeas(ideas.filter((_,i) => i !== idx))} title="Borrar" style={{ background:"none", border:"none", fontSize:11, cursor:"pointer", color:C.red, opacity:0.5, padding:"0 2px" }}>✕</button>
              </div>
              {scheduleIdea === idx && (
                <div style={{ display:"flex", gap:3, flexWrap:"wrap", padding:"6px 4px", background:`${C.accent}08`, borderRadius:"0 0 6px 6px", marginTop:1 }}>
                  <span style={{ fontSize:9, color:C.muted, width:"100%", marginBottom:2 }}>Mover a:</span>
                  {DAY_LABELS.map((d,i) => (
                    <button key={i} onClick={() => scheduleIdeaToDay(idx, i)} style={{
                      padding:"3px 6px", borderRadius:5, border:`1px solid ${C.border}`, background:`${C.accent}10`,
                      color:C.accent, fontSize:9, fontWeight:600, cursor:"pointer"
                    }}>{d}</button>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div style={{ display:"flex", gap:4, marginTop:6 }}>
            <input style={{ ...inputStyle, flex:1, fontSize:12 }} placeholder="Ej: Dakota Building (Lennon), café Birch..." value={ideaText} onChange={e => setIdeaText(e.target.value)} onKeyDown={e => e.key === "Enter" && addIdea()} />
            <button onClick={addIdea} style={{ padding:"8px 14px", borderRadius:8, border:"none", background:C.gold, color:"#000", fontWeight:700, fontSize:12, cursor:"pointer" }}>+</button>
          </div>
        </Card>
      )}

      {dayEvt.length === 0 && <div style={{ fontSize:12, color:C.muted, textAlign:"center", padding:20 }}>Sin eventos. Pulsa ➕</div>}

      {dayEvt.map(ev => {
        const dur = duration(ev.s, ev.e);
        const hasOverlap = overlap(ev.s, ev.e, ev.id);
        const isMoving = moving === ev.id;
        return (
          <div key={ev.id} style={{ marginBottom:6 }}>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ width:46, flexShrink:0, textAlign:"right", paddingTop:8 }}>
                <div style={{ fontSize:12, fontWeight:700, color:ev.c||C.accent }}>{ev.s}</div>
                <div style={{ fontSize:10, color:C.muted }}>{ev.e}</div>
                <div style={{ fontSize:8, color:C.muted }}>{dur}min</div>
              </div>
              <div onClick={() => !isMoving && startEdit(ev)} style={{ flex:1, borderLeft:`3px solid ${ev.c||C.accent}`, borderRadius:"0 8px 8px 0", padding:"8px 10px", background:`${ev.c||C.accent}0a`, border:`1px solid ${ev.c||C.accent}18`, position:"relative", cursor:ev.f?"default":"pointer" }}>
                <div style={{ fontSize:13, fontWeight:600, paddingRight:ev.f?18:50 }}>{ev.t}</div>
                {hasOverlap && <span style={{ fontSize:9, color:C.red }}>⚠️ Solapamiento</span>}
                {ev.lat && <DistBadge lat={ev.lat} lng={ev.lng} gps={gps} name={ev.t} />}
                {!ev.f && (
                  <div style={{ position:"absolute", top:5, right:5, display:"flex", gap:2 }}>
                    <button onClick={(e) => { e.stopPropagation(); setMoving(isMoving ? null : ev.id); }} title="Mover día" style={{ background:"none", border:"none", fontSize:11, cursor:"pointer", opacity:0.6, padding:"0 2px" }}>📦</button>
                    <button onClick={(e) => { e.stopPropagation(); sendToIdeas(ev); }} title="A pendientes" style={{ background:"none", border:"none", fontSize:11, cursor:"pointer", opacity:0.6, padding:"0 2px" }}>💡</button>
                    <button onClick={(e) => { e.stopPropagation(); setEvents(events.filter(x => x.id !== ev.id)); }} title="Borrar" style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:11, opacity:0.4, padding:"0 2px" }}>✕</button>
                  </div>
                )}
                {ev.f && <span style={{ position:"absolute", top:6, right:6, fontSize:8, color:C.muted }}>🔒</span>}
              </div>
            </div>
            {isMoving && (
              <div style={{ marginLeft:54, display:"flex", gap:3, flexWrap:"wrap", padding:"6px 6px", background:`${C.blue}10`, borderRadius:"0 0 8px 8px", marginTop:1, borderLeft:`3px solid ${C.blue}` }}>
                <span style={{ fontSize:9, color:C.muted, width:"100%" }}>📦 Mover a:</span>
                {DAY_LABELS.map((d,i) => (
                  <button key={i} onClick={() => moveToDay(ev.id, i)} disabled={i === day} style={{
                    padding:"3px 7px", borderRadius:5, fontSize:9, fontWeight:600, cursor:i===day?"default":"pointer",
                    border:`1px solid ${i===day?C.border:C.blue}40`,
                    background:i===day?`${C.muted}10`:`${C.blue}15`,
                    color:i===day?C.muted:C.blue, opacity:i===day?0.4:1
                  }}>{d}</button>
                ))}
                <button onClick={() => { sendToIdeas(ev); setMoving(null); }} style={{
                  padding:"3px 7px", borderRadius:5, fontSize:9, fontWeight:600, cursor:"pointer",
                  border:`1px solid ${C.gold}40`, background:`${C.gold}15`, color:C.gold
                }}>💡 A Ideas</button>
              </div>
            )}
          </div>
        );
      })}

      {!adding ? (
        <button onClick={() => { setAdding(true); setEditing(null); setMoving(null); setForm({ t:"", s:"09:00", e:"11:00", c:C.accent }); }} style={{ width:"100%", padding:12, borderRadius:10, border:`1px dashed ${C.accent}50`, background:"transparent", color:C.accent, fontSize:13, fontWeight:700, cursor:"pointer", marginTop:8 }}>➕ Añadir evento</button>
      ) : (
        <Card style={{ borderColor:`${C.accent}50`, marginTop:8 }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.accent, marginBottom:6 }}>{editing !== null ? "✏️ Editando evento" : "➕ Nuevo evento"}</div>
          <input style={{ ...inputStyle, marginBottom:6 }} placeholder="¿Qué vas a hacer?" value={form.t} onChange={e => setForm({...form, t:e.target.value})} autoFocus />
          <div style={{ display:"flex", gap:6, marginBottom:6 }}>
            <div style={{ flex:1 }}><label style={{ fontSize:10, color:C.muted }}>Inicio</label><input type="time" style={{ ...inputStyle, fontSize:12 }} value={form.s} onChange={e => setForm({...form, s:e.target.value})} /></div>
            <div style={{ flex:1 }}><label style={{ fontSize:10, color:C.muted }}>Fin</label><input type="time" style={{ ...inputStyle, fontSize:12 }} value={form.e} onChange={e => setForm({...form, e:e.target.value})} /></div>
          </div>
          {form.s && form.e && <div style={{ fontSize:10, color:C.muted, marginBottom:6 }}>⏱ Duración: {duration(form.s, form.e)} minutos</div>}
          <div style={{ display:"flex", gap:4, marginBottom:8 }}>
            {[C.accent, C.blue, C.green, C.red, C.purple, C.gold, C.pink, C.muted].map(c => (
              <button key={c} onClick={() => setForm({...form, c})} style={{ width:22, height:22, borderRadius:5, background:c, border:form.c===c?"2px solid #fff":"2px solid transparent", cursor:"pointer" }} />
            ))}
          </div>
          {overlap(form.s, form.e, editing) && <div style={{ fontSize:11, color:C.red, marginBottom:6, padding:"4px 8px", background:`${C.red}10`, borderRadius:6 }}>⚠️ Se solapa con otro evento en ese horario</div>}
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={save} style={{ flex:1, padding:10, borderRadius:8, border:"none", background:C.accent, color:"#fff", fontWeight:700, cursor:"pointer" }}>{editing !== null ? "Guardar cambios" : "Añadir"}</button>
            <button onClick={cancel} style={{ padding:"10px 16px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.muted, cursor:"pointer" }}>Cancelar</button>
          </div>
        </Card>
      )}

      <div style={{ fontSize:10, color:C.muted, marginTop:10, padding:"6px 8px", background:`${C.blue}08`, borderRadius:6, textAlign:"center" }}>
        📦 = mover a otro día · 💡 = guardar en Ideas · ✕ = borrar
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// 🎬 MOVIES TAB
// ═══════════════════════════════════════════
function MoviesTab({ gps }) {
  const [checks, setChecks] = useState(() => S.get("movies") || {});
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => { S.set("movies", checks); }, [checks]);

  const toggle = (mi, tid) => { const k = `${mi}-${tid}`; setChecks({...checks, [k]:!checks[k]}); };
  const allDone = (i) => TRAVELERS.every(t => checks[`${i}-${t.id}`]);
  const countDone = (i) => TRAVELERS.filter(t => checks[`${i}-${t.id}`]).length;

  const filtered = MOVIES.map((m,i) => ({...m, i})).filter(m => {
    if (filter === "all") return true;
    if (filter === "done") return allDone(m.i);
    if (filter === "todo") return !allDone(m.i);
    if (filter === "🎬") return m.type === "🎬";
    return m.type === "📺";
  });

  const totalChecks = Object.values(checks).filter(Boolean).length;

  return (
    <div style={{ padding: "12px 14px" }}>
      <Title sub="✓ Marcad las que veáis antes del viaje · 📍 En NY os avisa si estáis cerca">🎬 Pelis y series de Nueva York</Title>
      <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:10 }}>
        {[["all","Todas"],["todo","Por ver"],["done","Vistas ✓"],["🎬","Pelis"],["📺","Series"]].map(([k,l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding:"4px 8px", borderRadius:14, border:`1px solid ${filter===k?C.accent:C.border}`, background:filter===k?`${C.accent}18`:"transparent", color:filter===k?C.accent:C.muted, fontSize:10, fontWeight:600, cursor:"pointer" }}>{l}</button>
        ))}
      </div>
      <div style={{ fontSize:11, color:C.muted, marginBottom:10, padding:"5px 8px", background:`${C.gold}08`, borderRadius:6 }}>
        🍿 {MOVIES.filter((_,i) => allDone(i)).length}/{MOVIES.length} completadas por todos · {totalChecks} checks totales
      </div>

      {filtered.map(m => {
        const near = gps && m.spots.some(sp => haversine(gps.lat, gps.lng, sp.lat, sp.lng) < 500);
        return (
          <Card key={m.i} onClick={() => setOpen(open === m.i ? null : m.i)} style={{ borderLeft:allDone(m.i)?`3px solid ${C.green}`:near?`3px solid ${C.gold}`:undefined }}>
            <div style={{ display:"flex", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700 }}>
                  {m.type} {m.title} {near && <span style={{ fontSize:9, color:C.gold, background:`${C.gold}18`, padding:"1px 4px", borderRadius:3, marginLeft:4 }}>📍 ¡CERCA!</span>}
                </div>
                <div style={{ fontSize:11, color:C.muted }}>{m.year} · {m.spots.length} localización{m.spots.length > 1 ? "es" : ""}</div>
              </div>
              <span style={{ fontSize:10, color:allDone(m.i)?C.green:C.muted, fontWeight:700 }}>{countDone(m.i)}/5</span>
            </div>

            <div style={{ display:"flex", gap:5, marginTop:8 }} onClick={e => e.stopPropagation()}>
              {TRAVELERS.map(t => {
                const on = checks[`${m.i}-${t.id}`];
                return (
                  <button key={t.id} onClick={() => toggle(m.i, t.id)} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1, padding:"3px 5px", borderRadius:7, border:`1px solid ${on?C.green:C.border}`, background:on?`${C.green}12`:"transparent", cursor:"pointer", minWidth:38 }}>
                    <span style={{ fontSize:15 }}>{t.icon}</span>
                    <span style={{ fontSize:7, color:on?C.green:C.muted, fontWeight:700 }}>{on ? "✓" : t.name}</span>
                  </button>
                );
              })}
            </div>

            {open === m.i && (
              <div style={{ marginTop:10, borderTop:`1px solid ${C.border}`, paddingTop:8 }}>
                <div style={{ fontSize:11, fontWeight:700, color:C.accent, marginBottom:6 }}>📍 Localizaciones en NY:</div>
                {m.spots.map((sp,j) => (
                  <div key={j} style={{ marginBottom:5, padding:"5px 7px", background:`${C.blue}08`, borderRadius:6 }}>
                    <div style={{ fontSize:12, fontWeight:600 }}>📍 {sp.n}</div>
                    <DistBadge lat={sp.lat} lng={sp.lng} gps={gps} name={sp.n} />
                  </div>
                ))}
                {m.tip && <div style={{ fontSize:11, color:C.gold, marginTop:4 }}>💡 {m.tip}</div>}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════
// 🎪 EVENTS TAB
// ═══════════════════════════════════════════
function EventsTab({ gps }) {
  const [cat, setCat] = useState("all");
  const cats = ["all","🎭","🏳️‍🌈","⚾","🎵","😂"];
  const names = {all:"Todos","🎭":"Teatro","🏳️‍🌈":"Pride","⚾":"Deporte","🎵":"Música","😂":"Comedia"};
  const filtered = EVENTS.filter(e => cat === "all" || e.cat === cat);

  return (
    <div style={{ padding: "12px 14px" }}>
      <Title sub="Broadway, Pride, béisbol, jazz, comedia...">🎪 Eventos 20 Jun — 1 Jul</Title>
      <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:12 }}>
        {cats.map(c => (
          <button key={c} onClick={() => setCat(c)} style={{ padding:"4px 8px", borderRadius:14, border:`1px solid ${cat===c?C.accent:C.border}`, background:cat===c?`${C.accent}18`:"transparent", color:cat===c?C.accent:C.muted, fontSize:10, fontWeight:600, cursor:"pointer" }}>{c === "all" ? names[c] : `${c} ${names[c]}`}</button>
        ))}
      </div>
      {filtered.map((e,i) => (
        <Card key={i}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div style={{ fontSize:10, fontWeight:700, color:C.accent }}>{e.date}</div>
              <div style={{ fontSize:14, fontWeight:700, marginTop:1 }}>{e.cat} {e.name}</div>
              <div style={{ fontSize:11, color:C.muted }}>{e.where}</div>
            </div>
            <Badge c={C.gold}>{e.price}</Badge>
          </div>
          <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>💡 {e.tip}</div>
          {e.lat && <DistBadge lat={e.lat} lng={e.lng} gps={gps} name={e.name} />}
        </Card>
      ))}
      <Card style={{ background:`${C.accent}0a` }}>
        <div style={{ fontSize:13, fontWeight:700, color:C.accent, marginBottom:4 }}>🎫 Entradas baratas</div>
        <div style={{ fontSize:12, color:C.muted, lineHeight:1.6 }}>
          🎭 TKTS Times Sq: descuentos 50% mismo día<br/>📱 TodayTix app: lotería de entradas<br/>⚾ mlb.com o StubHub<br/>🎵 ticketmaster.com
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════
// 🍕 FOOD TAB
// ═══════════════════════════════════════════
function FoodTab({ gps }) {
  const [filter, setFilter] = useState("all");
  const priceC = {"$":C.green,"$$":C.gold,"$$$":C.accent,"$-$$":C.blue};
  const filtered = RESTAURANTS.filter(r => filter === "all" || (filter === "🇪🇸" ? r.type === "🇪🇸" : r.price === filter));

  const ratings = useRestaurantGrades();

  // Cargar ratings al primer render
  useEffect(() => {
    const names = RESTAURANTS.map(r => r.name);
    ratings.fetchGrades(names);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gradeColor = (g) => {
    if (g === "A") return C.green;
    if (g === "B") return C.gold;
    if (g === "C") return C.red;
    return C.muted;
  };

  return (
    <div style={{ padding: "12px 14px" }}>
      <Title sub="Con distancias y calificación oficial NYC Health Dept">🍕 Dónde comer</Title>
      <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:12 }}>
        {[["all","Todos"],["$","Barato"],["$$","Medio"],["$$$","Top"],["🇪🇸","Español"]].map(([k,l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding:"4px 8px", borderRadius:14, border:`1px solid ${filter===k?C.accent:C.border}`, background:filter===k?`${C.accent}18`:"transparent", color:filter===k?C.accent:C.muted, fontSize:10, fontWeight:600, cursor:"pointer" }}>{l}</button>
        ))}
      </div>
      {ratings.loading && (
        <div style={{ fontSize:10, color:C.muted, marginBottom:8, textAlign:"center" }}>
          Cargando calificaciones oficiales del NYC Health Dept...
        </div>
      )}
      {filtered.map((r,i) => {
        const grade = ratings.getGrade(r.name);
        return (
          <Card key={i} style={{ borderLeft:r.must?`3px solid ${C.gold}`:undefined }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                  {r.name} {r.must && "⭐"}
                  {grade && (
                    <span title={`Calificación oficial NYC Health Dept: ${grade}`} style={{
                      display:"inline-flex", alignItems:"center", justifyContent:"center",
                      width:22, height:22, borderRadius:4,
                      background: gradeColor(grade), color:"#fff",
                      fontSize:13, fontWeight:900
                    }}>{grade}</span>
                  )}
                </div>
                <div style={{ fontSize:11, color:C.muted }}>{r.zone}</div>
              </div>
              <div style={{ display:"flex", gap:3 }}><Badge c={C.blue}>{r.type}</Badge><Badge c={priceC[r.price]||C.muted}>{r.price}</Badge></div>
            </div>
            <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>{r.desc}</div>
            {r.lat && <DistBadge lat={r.lat} lng={r.lng} gps={gps} name={`${r.name} ${r.zone}`} />}
          </Card>
        );
      })}
      <Card style={{ background:`${C.green}08`, marginTop:8 }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.green, marginBottom:4 }}>🅰️ Calificaciones NYC Health Dept</div>
        <div style={{ fontSize:10, color:C.muted, lineHeight:1.6 }}>
          <span style={{ color:C.green, fontWeight:700 }}>A</span> = Excelente higiene · <span style={{ color:C.gold, fontWeight:700 }}>B</span> = Aceptable · <span style={{ color:C.red, fontWeight:700 }}>C</span> = Necesita mejoras<br/>
          ⚠️ La ausencia de letra significa que no encontramos coincidencia en la base de datos oficial (no implica nada negativo).
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════
// 🤖 AI TAB
// ═══════════════════════════════════════════
const AI_SYS = `Eres "NYC Guide 🗽", asistente de viaje familiar. Viaje NY 20 jun-1 jul 2026. 5 españoles de Astorga: Javi(21), Rosa(54), Paz(70), Viti(39), Miguel(54). Airbnb 65 Corbin Ave, Jersey City. PATH Journal Square. Vuelos Iberia IB0211/0212 JFK T8, código KRLGF. Seguro IMAWAY 250002H5 tel +34 913907318. MUNDIAL 2026 GRUPO H: 15jun España-Cabo Verde Atlanta 12pmET, 21jun España-Arabia Saudí Atlanta 12pmET, 26jun Uruguay-España Guadalajara 8pmET. España NO juega en MetLife ni en NY. Partidos en MetLife (cerca Jersey City): 16jun Francia-Senegal 3pmET, 22jun Noruega-Senegal 8pmET, 30jun Octavos 5pmET, 19jul FINAL. Para ver a España en NY: bares deportivos. Pride NYC 28 jun. Responde en español, conciso. Paz 70 años = accesible. Para traducciones: solo traducción + pronunciación.`;

function AITab() {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("chat");
  const [apiKey, setApiKey] = useState(() => S.get("apikey") || "");
  const ref = useRef(null);
  const hasKey = apiKey && apiKey.length > 10;

  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [msgs, loading]);

  const send = async (text) => {
    if (!text.trim() || !hasKey) return;
    const content = mode === "translate" ? `Traduce al inglés para usar en NY. Solo traducción + pronunciación. Frase: "${text}"` : text;
    const newMsgs = [...msgs, { role:"user", content }];
    setMsgs(newMsgs); setInput(""); setLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, system:AI_SYS, messages:newMsgs.map(m=>({role:m.role,content:m.content})) }),
      });
      const r = await res.json();
      if (r.error) { setMsgs([...newMsgs, { role:"assistant", content:`⚠️ Error API: ${r.error.message || "Revisa tu API Key"}` }]); setLoading(false); return; }
      const reply = r.content?.filter(b=>b.type==="text").map(b=>b.text).join("\n") || "No pude responder.";
      setMsgs([...newMsgs, { role:"assistant", content:reply }]);
    } catch(err) { setMsgs([...newMsgs, { role:"assistant", content:"⚠️ Error de conexión. Revisa tu API Key en la parte superior o tu conexión a internet." }]); }
    setLoading(false);
  };

  const quickQ = mode === "chat" ? ["¿Cómo llego al MetLife?","Restaurantes baratos Midtown","Metro para Central Park","Bares para ver a España"] : ["¿Dónde está el baño?","La cuenta, por favor","Somos 5, ¿tienen mesa?","¿Me puede recomendar algo?"];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 110px)" }}>
      <div style={{ display:"flex", gap:4, padding:"10px 14px 6px", background:C.bg2 }}>
        {[["chat","🤖 Guía"],["translate","🌐 Traductor"]].map(([m,l]) => (
          <button key={m} onClick={() => setMode(m)} style={{ flex:1, padding:"7px", borderRadius:8, border:`1px solid ${mode===m?C.accent:C.border}`, background:mode===m?`${C.accent}18`:"transparent", color:mode===m?C.accent:C.muted, fontSize:11, fontWeight:700, cursor:"pointer" }}>{l}</button>
        ))}
      </div>
      <div style={{ padding:"8px 14px", background:C.bg2 }}>
        {!hasKey ? (
          <>
            <div style={{ padding:"12px 14px", background:`${C.gold}12`, borderRadius:10, border:`1px solid ${C.gold}30`, marginBottom:8 }}>
              <div style={{ fontSize:12, fontWeight:700, color:C.gold, marginBottom:4 }}>🔑 API Key necesaria</div>
              <div style={{ fontSize:11, color:C.muted, lineHeight:1.5 }}>
                Para usar la Guía IA necesitas una API Key de Anthropic.<br/>
                1. Ve a <b style={{color:C.text}}>console.anthropic.com</b><br/>
                2. Crea cuenta o inicia sesión<br/>
                3. Ve a <b style={{color:C.text}}>API Keys</b> → Crear nueva<br/>
                4. Copia la key (empieza por <b style={{color:C.text}}>sk-ant-...</b>)
              </div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <input style={{ ...inputStyle, flex:1, fontSize:13 }} type="password" placeholder="Pega aquí tu sk-ant-..." value={apiKey} onChange={e => setApiKey(e.target.value)} />
              <button onClick={() => { S.set("apikey", apiKey); }} style={{ padding:"10px 16px", borderRadius:8, border:"none", background:C.accent, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Guardar</button>
            </div>
            <div style={{ fontSize:9, color:C.muted, marginTop:4 }}>🔒 Se guarda solo en tu navegador. No se envía a ningún otro sitio.</div>
          </>
        ) : (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:10, color:C.green }}>✅ API Key configurada</span>
            <button onClick={() => { S.set("apikey",""); setApiKey(""); }} style={{ fontSize:10, color:C.muted, background:"none", border:"none", cursor:"pointer", textDecoration:"underline" }}>Cambiar</button>
          </div>
        )}
      </div>
      <div ref={ref} style={{ flex:1, overflow:"auto", padding:"10px 14px", display:"flex", flexDirection:"column", gap:8 }}>
        {msgs.length === 0 && (
          <div style={{ textAlign:"center", padding:"16px 0" }}>
            <div style={{ fontSize:36, marginBottom:6 }}>{mode === "chat" ? "🗽" : "🌐"}</div>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:12 }}>{mode === "chat" ? "Tu guía de Nueva York" : "Traductor ES→EN"}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {quickQ.map((q,i) => <button key={i} onClick={() => send(q)} style={{ padding:"9px 12px", borderRadius:10, border:`1px solid ${C.border}`, background:C.card, color:C.text, fontSize:12, cursor:"pointer", textAlign:"left" }}>{q}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m,i) => (
          <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
            <div style={{ maxWidth:"85%", padding:"10px 14px", borderRadius:14, fontSize:13, lineHeight:1.6, whiteSpace:"pre-wrap", ...(m.role==="user" ? {background:C.accent, color:"#fff", borderBottomRightRadius:4} : {background:C.card, border:`1px solid ${C.border}`, borderBottomLeftRadius:4}) }}>{m.content}</div>
          </div>
        ))}
        {loading && <div style={{ fontSize:12, color:C.muted, padding:10 }}>Pensando...</div>}
      </div>
      <div style={{ padding:"8px 14px 10px", background:C.bg2, borderTop:`1px solid ${C.border}`, display:"flex", gap:8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key==="Enter" && send(input)} placeholder={mode==="chat"?"Pregunta...":"Escribe en español..."} style={{ ...inputStyle, flex:1, fontSize:13 }} />
        <button onClick={() => send(input)} disabled={loading||!input.trim()} style={{ padding:"10px 14px", borderRadius:10, border:"none", background:C.accent, color:"#fff", fontWeight:700, cursor:"pointer", opacity:loading||!input.trim()?0.4:1 }}>➤</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// 📁 DOCS SUB-TAB (dentro de Control)
// ═══════════════════════════════════════════
function DocsSubTab() {
  const [docs, setDocs] = useState(() => S.get("docs") || []);
  const [filter, setFilter] = useState("all");
  const [showSos, setShowSos] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name:"", url:"", cat:"flight", type:"PDF", note:"" });

  useEffect(() => { S.set("docs", docs); }, [docs]);

  const nextId = Math.max(0, ...docs.map(d => d.id || 0)) + 1;

  const resetForm = () => setForm({ name:"", url:"", cat:"flight", type:"PDF", note:"" });

  const startAdd = () => { resetForm(); setEditing(null); setAdding(true); };
  const startEdit = (doc) => {
    setForm({ name:doc.name, url:doc.url, cat:doc.cat, type:doc.type, note:doc.note||"" });
    setEditing(doc.id);
    setAdding(true);
  };
  const cancel = () => { setAdding(false); setEditing(null); resetForm(); };

  const save = () => {
    if (!form.name.trim() || !form.url.trim()) return;
    if (editing !== null) {
      setDocs(docs.map(d => d.id === editing ? { ...d, ...form } : d));
    } else {
      setDocs([...docs, { ...form, id:nextId, checks:{} }]);
    }
    setAdding(false);
    setEditing(null);
    resetForm();
  };

  const remove = (id) => setDocs(docs.filter(d => d.id !== id));

  const toggleCheck = (docId, travId) => {
    setDocs(docs.map(d => {
      if (d.id !== docId) return d;
      const nc = { ...(d.checks||{}) };
      nc[travId] = !nc[travId];
      return { ...d, checks:nc };
    }));
  };

  const filtered = docs.filter(d => filter === "all" || d.cat === filter);
  const catInfo = (id) => DOC_CATS.find(c => c.id === id) || DOC_CATS[5];

  return (
    <>
      {/* SOS PHONES */}
      <Card style={{ background:`${C.red}08`, borderColor:`${C.red}30`, marginBottom:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }} onClick={() => setShowSos(!showSos)}>
          <div style={{ fontSize:13, fontWeight:800, color:C.red }}>🆘 Teléfonos de emergencia</div>
          <span style={{ fontSize:11, color:C.muted }}>{showSos ? "▲" : "▼"}</span>
        </div>
        {showSos && (
          <div style={{ marginTop:8 }}>
            {SOS_PHONES.map((s,i) => (
              <a key={i} href={`tel:${s.phone.replace(/\s/g, "")}`} style={{ display:"block", textDecoration:"none", color:"inherit", marginBottom:5 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 9px", background:C.card, borderRadius:7, borderLeft:`3px solid ${s.c}` }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:C.text }}>{s.name}</div>
                    <div style={{ fontSize:10, color:C.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.note}</div>
                  </div>
                  <div style={{ fontSize:12, fontWeight:700, color:s.c, marginLeft:8, whiteSpace:"nowrap" }}>📞 {s.phone}</div>
                </div>
              </a>
            ))}
            <div style={{ fontSize:9, color:C.muted, marginTop:6, textAlign:"center" }}>Toca cualquiera para llamar 📱</div>
          </div>
        )}
      </Card>

      {/* TITLE + EXPLANATION */}
      <div style={{ marginBottom:10 }}>
        <div style={{ fontSize:14, fontWeight:800 }}>📁 Documentos del viaje</div>
        <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>Pega enlaces de Drive/Dropbox a tus PDFs e imágenes. Marca quién los tiene descargados.</div>
      </div>

      {/* CATEGORY FILTERS */}
      <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:10 }}>
        <button onClick={() => setFilter("all")} style={{ padding:"4px 8px", borderRadius:14, border:`1px solid ${filter==="all"?C.accent:C.border}`, background:filter==="all"?`${C.accent}18`:"transparent", color:filter==="all"?C.accent:C.muted, fontSize:10, fontWeight:600, cursor:"pointer" }}>Todos {docs.length > 0 && `(${docs.length})`}</button>
        {DOC_CATS.map(c => {
          const count = docs.filter(d => d.cat === c.id).length;
          return (
            <button key={c.id} onClick={() => setFilter(c.id)} style={{ padding:"4px 8px", borderRadius:14, border:`1px solid ${filter===c.id?c.c:C.border}`, background:filter===c.id?`${c.c}18`:"transparent", color:filter===c.id?c.c:C.muted, fontSize:10, fontWeight:600, cursor:"pointer" }}>
              {c.icon} {c.l}{count > 0 && ` (${count})`}
            </button>
          );
        })}
      </div>

      {/* EMPTY STATE */}
      {filtered.length === 0 && !adding && (
        <div style={{ textAlign:"center", padding:"24px 12px", color:C.muted, fontSize:12, background:C.card, borderRadius:10, border:`1px dashed ${C.border}`, marginBottom:10 }}>
          {docs.length === 0 ? (
            <>📋 Ningún documento todavía<br/><span style={{ fontSize:10 }}>Pulsa ➕ para añadir el primero</span></>
          ) : (
            <>Sin documentos en esta categoría</>
          )}
        </div>
      )}

      {/* DOCS LIST */}
      {filtered.map(d => {
        const ci = catInfo(d.cat);
        const checks = d.checks || {};
        const countChk = TRAVELERS.filter(t => checks[t.id]).length;
        return (
          <Card key={d.id} style={{ borderLeft:`3px solid ${ci.c}` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:700 }}>{ci.icon} {d.name}</div>
                <div style={{ display:"flex", gap:4, alignItems:"center", marginTop:3, flexWrap:"wrap" }}>
                  <Badge c={ci.c}>{ci.l}</Badge>
                  <Badge c={d.type === "PDF" ? C.red : C.purple}>{d.type === "PDF" ? "📄 PDF" : "🖼️ Imagen"}</Badge>
                  <span style={{ fontSize:9, color:C.muted }}>{countChk}/5 descargado</span>
                </div>
                {d.note && <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>💡 {d.note}</div>}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display:"flex", gap:6, marginTop:8 }}>
              <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ flex:1, textDecoration:"none" }}>
                <button style={{ width:"100%", padding:"7px", borderRadius:7, border:"none", background:ci.c, color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer" }}>🔗 Abrir</button>
              </a>
              <button onClick={() => startEdit(d)} style={{ padding:"7px 10px", borderRadius:7, border:`1px solid ${C.border}`, background:"transparent", color:C.muted, fontSize:11, cursor:"pointer" }}>✏️</button>
              <button onClick={() => { if (confirm(`¿Borrar "${d.name}"?`)) remove(d.id); }} style={{ padding:"7px 10px", borderRadius:7, border:`1px solid ${C.red}30`, background:`${C.red}08`, color:C.red, fontSize:11, cursor:"pointer" }}>🗑️</button>
            </div>

            {/* Traveler checks */}
            <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${C.border}` }}>
              <div style={{ fontSize:9, color:C.muted, marginBottom:4 }}>¿Quién lo tiene descargado?</div>
              <div style={{ display:"flex", gap:5 }}>
                {TRAVELERS.map(t => {
                  const on = checks[t.id];
                  return (
                    <button key={t.id} onClick={() => toggleCheck(d.id, t.id)} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1, padding:"3px 5px", borderRadius:7, border:`1px solid ${on?C.green:C.border}`, background:on?`${C.green}12`:"transparent", cursor:"pointer", minWidth:38 }}>
                      <span style={{ fontSize:15 }}>{t.icon}</span>
                      <span style={{ fontSize:7, color:on?C.green:C.muted, fontWeight:700 }}>{on ? "✓" : t.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
        );
      })}

      {/* ADD/EDIT FORM */}
      {!adding ? (
        <button onClick={startAdd} style={{ width:"100%", padding:12, borderRadius:10, border:`1px dashed ${C.accent}50`, background:"transparent", color:C.accent, fontSize:13, fontWeight:700, cursor:"pointer", marginTop:8 }}>➕ Añadir documento</button>
      ) : (
        <Card style={{ borderColor:`${C.accent}50`, marginTop:8 }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.accent, marginBottom:8 }}>{editing !== null ? "✏️ Editando documento" : "➕ Nuevo documento"}</div>

          <label style={{ fontSize:10, color:C.muted, display:"block", marginBottom:2 }}>Nombre</label>
          <input style={{ ...inputStyle, marginBottom:8 }} placeholder="Ej: Tarjeta embarque Miguel" value={form.name} onChange={e => setForm({...form, name:e.target.value})} autoFocus />

          <label style={{ fontSize:10, color:C.muted, display:"block", marginBottom:2 }}>Enlace (Google Drive, Dropbox, etc.)</label>
          <input style={{ ...inputStyle, marginBottom:8 }} placeholder="https://drive.google.com/..." value={form.url} onChange={e => setForm({...form, url:e.target.value})} />

          <label style={{ fontSize:10, color:C.muted, display:"block", marginBottom:4 }}>Categoría</label>
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:10 }}>
            {DOC_CATS.map(c => (
              <button key={c.id} onClick={() => setForm({...form, cat:c.id})} style={{ padding:"5px 9px", borderRadius:7, border:`1px solid ${form.cat===c.id?c.c:C.border}`, background:form.cat===c.id?`${c.c}20`:"transparent", color:form.cat===c.id?c.c:C.muted, fontSize:10, fontWeight:700, cursor:"pointer" }}>
                {c.icon} {c.l}
              </button>
            ))}
          </div>

          <label style={{ fontSize:10, color:C.muted, display:"block", marginBottom:4 }}>Tipo</label>
          <div style={{ display:"flex", gap:6, marginBottom:10 }}>
            {[["PDF","📄 PDF",C.red],["IMG","🖼️ Imagen",C.purple]].map(([k,l,col]) => (
              <button key={k} onClick={() => setForm({...form, type:k})} style={{ flex:1, padding:"7px", borderRadius:7, border:`1px solid ${form.type===k?col:C.border}`, background:form.type===k?`${col}15`:"transparent", color:form.type===k?col:C.muted, fontSize:11, fontWeight:700, cursor:"pointer" }}>{l}</button>
            ))}
          </div>

          <label style={{ fontSize:10, color:C.muted, display:"block", marginBottom:2 }}>Nota (opcional)</label>
          <input style={{ ...inputStyle, marginBottom:10 }} placeholder="Ej: caduca el 12/2030, número de póliza..." value={form.note} onChange={e => setForm({...form, note:e.target.value})} />

          <div style={{ display:"flex", gap:6 }}>
            <button onClick={save} style={{ flex:1, padding:10, borderRadius:8, border:"none", background:C.accent, color:"#fff", fontWeight:700, cursor:"pointer" }}>{editing !== null ? "Guardar cambios" : "Añadir"}</button>
            <button onClick={cancel} style={{ padding:"10px 16px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.muted, cursor:"pointer" }}>Cancelar</button>
          </div>
        </Card>
      )}

      {/* HELP TIP */}
      <Card style={{ background:`${C.blue}08`, borderColor:`${C.blue}25`, marginTop:10 }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.blue, marginBottom:4 }}>💡 Cómo conseguir el enlace</div>
        <div style={{ fontSize:10, color:C.muted, lineHeight:1.6 }}>
          <b style={{ color:C.text }}>Google Drive:</b> sube el archivo → clic derecho → Compartir → "Cualquiera con el enlace" → Copiar.<br/>
          <b style={{ color:C.text }}>Dropbox:</b> clic derecho sobre el archivo → "Copiar enlace".<br/>
          ⚠️ Solo comparte estos enlaces con tus acompañantes de viaje.
        </div>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════
// 💬 GROUP SUB-TAB (WhatsApp boost dentro de Control)
// ═══════════════════════════════════════════
function GroupSubTab({ gps }) {
  const [meetPoint, setMeetPoint] = useState("");

  // Helpers para construir URLs de WhatsApp
  // wa.me funciona en móvil y web. Quitamos el "+" del teléfono
  const waLink = (phone, text = "") => {
    const clean = phone.replace(/[^0-9]/g, "");
    return `https://wa.me/${clean}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
  };

  // Para enviar al grupo necesitamos abrir el grupo manualmente
  // (WhatsApp no permite enviar texto directamente a un grupo por URL — hay que copiar)
  const sendToGroup = (text) => {
    // Copiamos el texto al portapapeles y abrimos el grupo
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    window.open(GROUP_WHATSAPP_URL, "_blank");
  };

  // Mensaje de ubicación con coordenadas + enlace a Maps
  const buildLocationMsg = (extra = "") => {
    if (gps) {
      const mapsUrl = `https://www.google.com/maps?q=${gps.lat},${gps.lng}`;
      return `📍 Estoy aquí${extra ? ` ${extra}` : ""}: ${mapsUrl}`;
    }
    return `📍 Estoy en Nueva York${extra ? ` ${extra}` : ""}`;
  };

  // SOS message con ubicación
  const sosMsg = () => {
    const base = "🆘 NECESITO AYUDA URGENTE";
    if (gps) {
      const mapsUrl = `https://www.google.com/maps?q=${gps.lat},${gps.lng}`;
      return `${base}\n📍 Mi ubicación: ${mapsUrl}\n📞 Llamadme por favor`;
    }
    return `${base}\n📞 Llamadme por favor`;
  };

  // Click handler para mensajes rápidos
  const sendQuick = (msg) => {
    if (msg.text.endsWith(": ") && meetPoint) {
      // Para "Punto de encuentro" añadimos lo escrito
      sendToGroup(`${msg.icon} ${msg.text}${meetPoint}`);
    } else {
      sendToGroup(`${msg.icon} ${msg.text}`);
    }
  };

  return (
    <>
      {/* HERO BUTTON: Open the WhatsApp group */}
      <a href={GROUP_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none" }}>
        <div style={{
          padding:"14px 16px", borderRadius:12, marginBottom:10,
          background:`linear-gradient(135deg, #128C7E, #25D366)`,
          color:"#fff", textAlign:"center", cursor:"pointer",
          boxShadow:"0 4px 12px rgba(37, 211, 102, 0.25)"
        }}>
          <div style={{ fontSize:30, marginBottom:2 }}>💚</div>
          <div style={{ fontSize:15, fontWeight:800 }}>Abrir grupo de WhatsApp</div>
          <div style={{ fontSize:10, opacity:0.85, marginTop:2 }}>5 viajeros · Toca para abrir el chat</div>
        </div>
      </a>

      {/* SHARE MY LOCATION */}
      <Card style={{ background:`${C.blue}08`, borderColor:`${C.blue}30` }}>
        <div style={{ fontSize:13, fontWeight:800, color:C.blue, marginBottom:6 }}>📍 Compartir mi ubicación</div>
        <div style={{ fontSize:10, color:C.muted, marginBottom:8 }}>
          {gps ? "✅ GPS activo. Compartirá tu ubicación exacta." : "⚠️ GPS desactivado. Activa el GPS arriba para compartir ubicación exacta."}
        </div>
        <button
          onClick={() => sendToGroup(buildLocationMsg())}
          disabled={!gps}
          style={{
            width:"100%", padding:10, borderRadius:8, border:"none",
            background: gps ? C.blue : C.border,
            color: gps ? "#fff" : C.muted,
            fontSize:12, fontWeight:700, cursor: gps ? "pointer" : "not-allowed",
            opacity: gps ? 1 : 0.5
          }}
        >
          📍 Enviar mi ubicación al grupo
        </button>
      </Card>

      {/* QUICK MESSAGES */}
      <Card>
        <div style={{ fontSize:13, fontWeight:800, marginBottom:8 }}>⚡ Mensajes rápidos</div>
        <div style={{ fontSize:10, color:C.muted, marginBottom:8 }}>
          Toca para abrir el grupo con el mensaje copiado al portapapeles. Pega con mantener pulsado en WhatsApp.
        </div>

        {/* Punto de encuentro con input */}
        <div style={{ display:"flex", gap:6, marginBottom:8 }}>
          <input
            type="text"
            placeholder="Ej: Times Square, Apple Store..."
            value={meetPoint}
            onChange={e => setMeetPoint(e.target.value)}
            style={{ ...inputStyle, fontSize:12 }}
          />
        </div>

        {QUICK_MESSAGES.map((msg, i) => (
          <button
            key={i}
            onClick={() => sendQuick(msg)}
            disabled={msg.text.endsWith(": ") && !meetPoint.trim()}
            style={{
              width:"100%", padding:"9px 12px", borderRadius:8, marginBottom:5,
              border:`1px solid ${C.border}`, background:C.card,
              color:C.text, fontSize:12, fontWeight:600, cursor:"pointer",
              textAlign:"left",
              opacity: (msg.text.endsWith(": ") && !meetPoint.trim()) ? 0.4 : 1
            }}
          >
            <span style={{ marginRight:8 }}>{msg.icon}</span>
            {msg.text}{msg.text.endsWith(": ") && meetPoint ? meetPoint : ""}
          </button>
        ))}
      </Card>

      {/* SOS BUTTON */}
      <Card style={{ background:`${C.red}08`, borderColor:`${C.red}40` }}>
        <div style={{ fontSize:13, fontWeight:800, color:C.red, marginBottom:6 }}>🆘 Emergencia</div>
        <div style={{ fontSize:10, color:C.muted, marginBottom:8 }}>
          Envía un mensaje urgente al grupo {gps ? "con tu ubicación GPS" : "(activa GPS para incluir ubicación)"}
        </div>
        <button
          onClick={() => sendToGroup(sosMsg())}
          style={{
            width:"100%", padding:12, borderRadius:8, border:"none",
            background: C.red, color:"#fff",
            fontSize:13, fontWeight:800, cursor:"pointer",
            boxShadow:"0 2px 8px rgba(239, 68, 68, 0.3)"
          }}
        >
          🆘 PEDIR AYUDA AL GRUPO
        </button>
      </Card>

      {/* INDIVIDUAL CONTACTS */}
      <Card>
        <div style={{ fontSize:13, fontWeight:800, marginBottom:8 }}>👥 Contactos individuales</div>
        <div style={{ fontSize:10, color:C.muted, marginBottom:10 }}>
          Llamar o enviar WhatsApp privado a cada viajero
        </div>
        {TRAVELERS.map(t => (
          <div key={t.id} style={{
            display:"flex", alignItems:"center", gap:8,
            padding:"8px 10px", marginBottom:5,
            background:C.card, borderRadius:8, border:`1px solid ${C.border}`
          }}>
            <span style={{ fontSize:24 }}>{t.icon}</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:700 }}>{t.name}</div>
              <div style={{ fontSize:10, color:C.muted }}>{t.phone}</div>
            </div>
            <a href={`tel:${t.phone.replace(/\s/g, "")}`} title={`Llamar a ${t.name}`} style={{ textDecoration:"none" }}>
              <button style={{
                padding:"7px 10px", borderRadius:7, border:"none",
                background:C.blue, color:"#fff",
                fontSize:11, fontWeight:700, cursor:"pointer"
              }}>📞</button>
            </a>
            {t.wa && (
              <a href={waLink(t.phone)} target="_blank" rel="noopener noreferrer" title={`WhatsApp con ${t.name}`} style={{ textDecoration:"none" }}>
                <button style={{
                  padding:"7px 10px", borderRadius:7, border:"none",
                  background:"#25D366", color:"#fff",
                  fontSize:11, fontWeight:700, cursor:"pointer"
                }}>💬</button>
              </a>
            )}
          </div>
        ))}
      </Card>

      {/* HELP TIP */}
      <Card style={{ background:`${C.gold}08`, borderColor:`${C.gold}25` }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.gold, marginBottom:4 }}>💡 Cómo funcionan los mensajes rápidos</div>
        <div style={{ fontSize:10, color:C.muted, lineHeight:1.6 }}>
          Cuando pulsas un mensaje rápido, se <b style={{ color:C.text }}>copia automáticamente</b> al portapapeles y se abre el grupo. En el chat del grupo, mantén pulsado en el campo de texto y elige <b style={{ color:C.text }}>"Pegar"</b>. Después dale a enviar.<br/><br/>
          ⚠️ WhatsApp no permite enviar texto a grupos directamente desde un enlace por seguridad. Por eso hace falta el paso de pegar.
        </div>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════
// 💰 CONTROL TAB
// ═══════════════════════════════════════════
function ControlTab({ gps, fx }) {
  const [sub, setSub] = useState("budget");
  const [expenseFilter, setExpenseFilter] = useState("all");
  const [expWarning, setExpWarning] = useState("");
  const [expenses, setExpenses] = useState(() => {
    const stored = S.get("exp");
    if (stored) {
      // Migración: gastos antiguos sin currency se asumen EUR (los pre-viaje)
      return stored.map(e => e.currency ? e : { ...e, currency: "EUR" });
    }
    return [
      { name:"Vuelos (5 pers)",  amount:5050.25, cat:"transport", fixed:true, currency:"EUR" },
      { name:"Seguro IMAWAY",    amount:392.87,  cat:"other",     fixed:true, currency:"EUR" },
      { name:"Comisión Sequra",  amount:147.00,  cat:"other",     fixed:true, currency:"EUR" },
    ];
  });
  const [newN, setNewN] = useState("");
  const [newA, setNewA] = useState("");
  const [newC, setNewC] = useState("food");
  const [newCur, setNewCur] = useState("USD"); // moneda por defecto: USD (estaremos en NY)
  const [checklist, setChecklist] = useState(() => S.get("chk") || [
    { t:"✅ Pasaporte Rosa renovado", d:true }, { t:"Tramitar ESTA (14$/pers)", d:false },
    { t:"Seguro ✓", d:true }, { t:"Vuelos ✓", d:true }, { t:"Airbnb ✓", d:true },
    { t:"Adaptadores enchufe", d:false }, { t:"Revolut/N26", d:false },
    { t:"Reservar ferry Libertad", d:false }, { t:"eSIM datos", d:false },
    { t:"Entradas Mundial", d:false }, { t:"Apps: Maps, Citymapper", d:false },
    { t:"Protector solar", d:false }, { t:"Dólares efectivo", d:false },
  ]);
  const [notes, setNotes] = useState(() => S.get("notes") || "");

  useEffect(() => { S.set("exp", expenses); }, [expenses]);
  useEffect(() => { S.set("chk", checklist); }, [checklist]);
  useEffect(() => { S.set("notes", notes); }, [notes]);

  const cats = [{id:"transport",l:"🚇 Transporte",c:C.blue},{id:"food",l:"🍕 Comida",c:C.gold},{id:"tickets",l:"🎟️ Entradas",c:C.purple},{id:"shopping",l:"🛍️ Compras",c:C.pink},{id:"football",l:"⚽ Mundial",c:C.green},{id:"other",l:"📦 Otros",c:C.muted}];

  // Devuelve el importe del gasto en EUR (usa amountEur si existe, si no convierte sobre la marcha o pasa tal cual si es EUR)
  const toEur = (e) => {
    if (!e || !e.amount) return 0;
    if (e.currency === "USD") {
      return e.amountEur != null ? e.amountEur : e.amount * fx.rate;
    }
    return e.amount; // EUR
  };

  // Totales en EUR (todo convertido)
  const total = expenses.reduce((s,e) => s + toEur(e), 0);
  const filteredExpenses = expenseFilter === "all" ? expenses : expenses.filter(e => e.cat === expenseFilter);
  const filteredTotal = filteredExpenses.reduce((s,e) => s + toEur(e), 0);
  const filteredPercent = total > 0 ? (filteredTotal / total) * 100 : 0;

  // Resúmenes por moneda (solo importes nativos)
  const totalUsd = expenses.filter(e => e.currency === "USD").reduce((s,e) => s + (e.amount||0), 0);
  const totalEurNative = expenses.filter(e => e.currency !== "USD").reduce((s,e) => s + (e.amount||0), 0);
  const hasBothCurrencies = totalUsd > 0 && totalEurNative > 0;

  // Conversión en vivo del input mientras se escribe (preview)
  const previewEur = (newA && newCur === "USD") ? parseFloat(newA) * fx.rate : null;
  const previewUsd = (newA && newCur === "EUR") ? parseFloat(newA) / fx.rate : null;

  const addExp = () => {
    if (!newN.trim() && !newA) { setExpWarning("⚠️ Escribe una descripción y un importe"); return; }
    if (!newN.trim()) { setExpWarning("⚠️ Falta la descripción del gasto"); return; }
    if (!newA) { setExpWarning("⚠️ Falta el importe"); return; }
    const amt = parseFloat(newA);
    const newExp = {
      name: newN.trim(),
      amount: amt,
      cat: newC,
      currency: newCur,
    };
    // Si es USD, guardamos también el equivalente en EUR con la tasa del momento
    if (newCur === "USD") {
      newExp.amountEur = amt * fx.rate;
      newExp.fxRate = fx.rate;
      newExp.addedAt = Date.now();
    }
    setExpenses([...expenses, newExp]);
    setNewN(""); setNewA(""); setExpWarning("");
  };
  const doneN = checklist.filter(c=>c.d).length;

  return (
    <div>
      <div style={{ display:"flex", gap:4, padding:"10px 14px 6px", background:C.bg2, overflowX:"auto" }}>
        {[["budget","💰 Gastos"],["check","✅ Check"],["notes","📝 Notas"],["docs","📁 Docs"],["group","💬 Grupo"]].map(([k,l]) => (
          <button key={k} onClick={() => setSub(k)} style={{ flex:"1 1 0", minWidth:70, padding:"7px", borderRadius:8, border:`1px solid ${sub===k?C.accent:C.border}`, background:sub===k?`${C.accent}18`:"transparent", color:sub===k?C.accent:C.muted, fontSize:10, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>{l}</button>
        ))}
      </div>
      <div style={{ padding:"12px 14px" }}>
        {sub === "budget" && <>
          {/* Tarjetas TOTAL y POR PERSONA (siempre en EUR equivalente, suma de TODOS los gastos) */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
            {[["TOTAL VIAJE",total,C.accent],["POR PERSONA",total/5,C.green]].map(([l,v,c],i) => (
              <div key={i} style={{ background:`${c}12`, borderRadius:10, padding:12, textAlign:"center", border:`1px solid ${c}25` }}>
                <div style={{ fontSize:9, color:c, fontWeight:700 }}>{l}</div>
                <div style={{ fontSize:20, fontWeight:900, color:c }}>{v.toFixed(2)} €</div>
                <div style={{ fontSize:8, color:C.muted, marginTop:1 }}>en EUR equivalente</div>
              </div>
            ))}
          </div>

          {/* Resumen por moneda (solo si hay gastos en ambas) */}
          {hasBothCurrencies && (
            <div style={{ display:"flex", gap:6, marginBottom:10 }}>
              <div style={{ flex:1, padding:"7px 9px", borderRadius:8, background:`${C.blue}10`, border:`1px solid ${C.blue}30` }}>
                <div style={{ fontSize:9, color:C.blue, fontWeight:700 }}>🇪🇸 PRE-VIAJE (EUR)</div>
                <div style={{ fontSize:14, fontWeight:800, color:C.blue }}>{totalEurNative.toFixed(2)} €</div>
              </div>
              <div style={{ flex:1, padding:"7px 9px", borderRadius:8, background:`${C.green}10`, border:`1px solid ${C.green}30` }}>
                <div style={{ fontSize:9, color:C.green, fontWeight:700 }}>🇺🇸 EN NY (USD)</div>
                <div style={{ fontSize:14, fontWeight:800, color:C.green }}>$ {totalUsd.toFixed(2)}</div>
                <div style={{ fontSize:8, color:C.muted }}>≈ {(totalUsd * fx.rate).toFixed(2)} €</div>
              </div>
            </div>
          )}

          {/* Banda de filtrado activo (solo si hay filtro) */}
          {expenseFilter !== "all" && (() => {
            const ct = cats.find(c => c.id === expenseFilter);
            return (
              <div style={{
                padding:"8px 12px", borderRadius:8, marginBottom:10,
                background:`${ct.c}10`, border:`1px solid ${ct.c}30`,
              }}>
                <div style={{ fontSize:11, color:C.muted }}>
                  Filtrando <span style={{ color:ct.c, fontWeight:700 }}>{ct.l}</span>:{" "}
                  <span style={{ color:ct.c, fontWeight:800 }}>{filteredTotal.toFixed(2)} €</span>{" "}
                  <span style={{ color:C.muted, fontSize:10 }}>
                    ({filteredPercent.toFixed(1)}% del total · {(filteredTotal/5).toFixed(2)} €/persona)
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Chips de filtro por categoría */}
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:12 }}>
            <button onClick={() => setExpenseFilter("all")} style={{
              padding:"4px 8px", borderRadius:14,
              border:`1px solid ${expenseFilter==="all"?C.accent:C.border}`,
              background:expenseFilter==="all"?`${C.accent}18`:"transparent",
              color:expenseFilter==="all"?C.accent:C.muted,
              fontSize:10, fontWeight:600, cursor:"pointer"
            }}>Todos ({expenses.length})</button>
            {cats.map(c => {
              const count = expenses.filter(e => e.cat === c.id).length;
              if (count === 0) return null;
              return (
                <button key={c.id} onClick={() => setExpenseFilter(c.id)} style={{
                  padding:"4px 8px", borderRadius:14,
                  border:`1px solid ${expenseFilter===c.id?c.c:C.border}`,
                  background:expenseFilter===c.id?`${c.c}18`:"transparent",
                  color:expenseFilter===c.id?c.c:C.muted,
                  fontSize:10, fontWeight:600, cursor:"pointer"
                }}>{c.l} ({count})</button>
              );
            })}
          </div>

          {/* Formulario para añadir gasto */}
          <Card>
            <div style={{ fontSize:11, fontWeight:700, color:C.muted, marginBottom:6 }}>➕ Nuevo gasto</div>

            {/* Selector de moneda */}
            <div style={{ display:"flex", gap:6, marginBottom:6 }}>
              {[["USD","🇺🇸 USD ($)",C.green],["EUR","🇪🇸 EUR (€)",C.blue]].map(([k,l,col]) => (
                <button key={k} onClick={() => setNewCur(k)} style={{
                  flex:1, padding:"7px", borderRadius:8,
                  border:`1px solid ${newCur===k?col:C.border}`,
                  background:newCur===k?`${col}18`:"transparent",
                  color:newCur===k?col:C.muted,
                  fontSize:11, fontWeight:700, cursor:"pointer"
                }}>{l}</button>
              ))}
            </div>

            <input style={{ ...inputStyle, marginBottom:6 }} placeholder="Descripción (ej: Pizza Joe's)" value={newN} onChange={e => { setNewN(e.target.value); if (expWarning) setExpWarning(""); }} />
            <div style={{ display:"flex", gap:6, marginBottom:6 }}>
              <input
                style={{ ...inputStyle, width:"35%" }}
                placeholder={newCur === "USD" ? "$" : "€"}
                type="number"
                step="0.01"
                value={newA}
                onChange={e => { setNewA(e.target.value); if (expWarning) setExpWarning(""); }}
                onKeyDown={e => e.key==="Enter" && addExp()}
              />
              <select style={{ ...inputStyle, width:"65%" }} value={newC} onChange={e => setNewC(e.target.value)}>{cats.map(c => <option key={c.id} value={c.id}>{c.l}</option>)}</select>
            </div>

            {/* Conversión en vivo */}
            {newA && (
              <div style={{ fontSize:11, color:C.muted, marginBottom:6, padding:"5px 9px", background:`${C.gold}08`, borderRadius:6, textAlign:"center" }}>
                {newCur === "USD" && previewEur != null && (
                  <>💱 ${parseFloat(newA).toFixed(2)} ≈ <span style={{ color:C.gold, fontWeight:700 }}>{previewEur.toFixed(2)} €</span> <span style={{ fontSize:9 }}>(tasa {fx.rate.toFixed(4)})</span></>
                )}
                {newCur === "EUR" && previewUsd != null && (
                  <>💱 €{parseFloat(newA).toFixed(2)} ≈ <span style={{ color:C.gold, fontWeight:700 }}>$ {previewUsd.toFixed(2)}</span> <span style={{ fontSize:9 }}>(tasa {fx.rate.toFixed(4)})</span></>
                )}
              </div>
            )}

            {expWarning && (
              <div style={{ fontSize:11, color:C.red, padding:"6px 10px", background:`${C.red}10`, border:`1px solid ${C.red}30`, borderRadius:6, marginBottom:6 }}>
                {expWarning}
              </div>
            )}
            <button onClick={addExp} style={{ width:"100%", padding:10, borderRadius:8, border:"none", background:C.accent, color:"#fff", fontWeight:700, cursor:"pointer" }}>Añadir gasto</button>
          </Card>

          {/* Lista filtrada */}
          {filteredExpenses.length === 0 && expenseFilter !== "all" && (
            <div style={{ textAlign:"center", padding:"20px 12px", color:C.muted, fontSize:12 }}>
              Sin gastos en esta categoría todavía
            </div>
          )}
          {filteredExpenses.map((e) => {
            const i = expenses.indexOf(e);
            const ct = cats.find(c=>c.id===e.cat);
            const isUsd = e.currency === "USD";
            const eurEquiv = toEur(e);
            return (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 14px", borderBottom:`1px solid ${C.border}`, gap:8 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600 }}>{e.name}</div>
                  <div style={{ fontSize:10, color:ct?.c }}>{ct?.l}</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                  <div style={{ textAlign:"right" }}>
                    {isUsd ? (
                      <>
                        <div style={{ fontSize:13, fontWeight:700, color:C.green }}>$ {e.amount.toFixed(2)}</div>
                        <div style={{ fontSize:9, color:C.muted }}>≈ {eurEquiv.toFixed(2)} €</div>
                      </>
                    ) : (
                      <div style={{ fontSize:13, fontWeight:700 }}>{e.amount.toFixed(2)} €</div>
                    )}
                  </div>
                  {!e.fixed && <button onClick={() => setExpenses(expenses.filter((_,j)=>j!==i))} style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:12 }}>✕</button>}
                </div>
              </div>
            );
          })}
        </>}
        {sub === "check" && (
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <span style={{ fontSize:14, fontWeight:700 }}>📋 {doneN}/{checklist.length}</span>
              <div style={{ width:80, height:6, borderRadius:3, background:C.border, overflow:"hidden" }}><div style={{ width:`${(doneN/checklist.length)*100}%`, height:"100%", background:C.green, transition:"width .3s" }} /></div>
            </div>
            {checklist.map((item,i) => (
              <div key={i} onClick={() => { const u=[...checklist]; u[i]={...u[i], d:!u[i].d}; setChecklist(u); }} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", cursor:"pointer", borderBottom:`1px solid ${C.border}` }}>
                <div style={{ width:18, height:18, borderRadius:4, border:`2px solid ${item.d?C.green:C.border}`, background:item.d?`${C.green}18`:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:10, color:C.green }}>{item.d && "✓"}</div>
                <span style={{ fontSize:12, color:item.d?C.muted:C.text, textDecoration:item.d?"line-through":"none" }}>{item.t}</span>
              </div>
            ))}
          </Card>
        )}
        {sub === "notes" && (
          <Card><textarea style={{ ...inputStyle, minHeight:250, resize:"vertical", lineHeight:1.6 }} placeholder="Notas, ideas, links..." value={notes} onChange={e => setNotes(e.target.value)} /></Card>
        )}
        {sub === "docs" && <DocsSubTab />}
        {sub === "group" && <GroupSubTab gps={gps} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// WORLD CUP TAB
// ═══════════════════════════════════════════
const WC_MATCHES = [
  { d:"20 Jun", dow:"Sáb", h:"13:00", esp:"19:00", a:"🇳🇱 Países Bajos", b:"UEFA Playoff B", g:"F", v:"Houston", ml:false, sp:false },
  { d:"20 Jun", dow:"Sáb", h:"16:00", esp:"22:00", a:"🇩🇪 Alemania", b:"🇨🇮 Costa de Marfil", g:"E", v:"Toronto", ml:false, sp:false },
  { d:"20 Jun", dow:"Sáb", h:"20:00", esp:"02:00+1", a:"🇪🇨 Ecuador", b:"🇨🇼 Curaçao", g:"E", v:"Kansas City", ml:false, sp:false },
  { d:"20 Jun", dow:"Sáb", h:"00:00+1", esp:"06:00+1", a:"🇹🇳 Túnez", b:"🇯🇵 Japón", g:"F", v:"Monterrey 🇲🇽", ml:false, sp:false },
  { d:"21 Jun", dow:"Dom", h:"12:00", esp:"18:00", a:"🇪🇸 ESPAÑA", b:"🇸🇦 Arabia Saudí", g:"H", v:"Atlanta", ml:false, sp:true },
  { d:"21 Jun", dow:"Dom", h:"15:00", esp:"21:00", a:"🇧🇪 Bélgica", b:"🇮🇷 Irán", g:"G", v:"Los Ángeles", ml:false, sp:false },
  { d:"21 Jun", dow:"Dom", h:"18:00", esp:"00:00+1", a:"🇺🇾 Uruguay", b:"🇨🇻 Cabo Verde", g:"H", v:"Miami", ml:false, sp:false },
  { d:"21 Jun", dow:"Dom", h:"21:00", esp:"03:00+1", a:"🇳🇿 N. Zelanda", b:"🇪🇬 Egipto", g:"G", v:"Vancouver 🇨🇦", ml:false, sp:false },
  { d:"22 Jun", dow:"Lun", h:"13:00", esp:"19:00", a:"🇦🇷 Argentina", b:"🇦🇹 Austria", g:"J", v:"Dallas", ml:false, sp:false },
  { d:"22 Jun", dow:"Lun", h:"17:00", esp:"23:00", a:"🇫🇷 Francia", b:"IC Playoff 2", g:"I", v:"Philadelphia", ml:false, sp:false },
  { d:"22 Jun", dow:"Lun", h:"20:00", esp:"02:00+1", a:"🇳🇴 Noruega", b:"🇸🇳 Senegal", g:"I", v:"🏟️ MetLife", ml:true, sp:false },
  { d:"22 Jun", dow:"Lun", h:"23:00", esp:"05:00+1", a:"🇯🇴 Jordania", b:"🇩🇿 Argelia", g:"J", v:"San Francisco", ml:false, sp:false },
  { d:"23 Jun", dow:"Mar", h:"13:00", esp:"19:00", a:"🇵🇹 Portugal", b:"🇺🇿 Uzbekistán", g:"K", v:"Houston", ml:false, sp:false },
  { d:"23 Jun", dow:"Mar", h:"16:00", esp:"22:00", a:"🏴󠁧󠁢󠁥󠁮󠁧󠁿 Inglaterra", b:"🇬🇭 Ghana", g:"L", v:"Boston", ml:false, sp:false },
  { d:"23 Jun", dow:"Mar", h:"19:00", esp:"01:00+1", a:"🇵🇦 Panamá", b:"🇭🇷 Croacia", g:"L", v:"Toronto", ml:false, sp:false },
  { d:"23 Jun", dow:"Mar", h:"22:00", esp:"04:00+1", a:"🇨🇴 Colombia", b:"IC Playoff 1", g:"K", v:"Guadalajara 🇲🇽", ml:false, sp:false },
  { d:"24 Jun", dow:"Mié", h:"15:00", esp:"21:00", a:"🇨🇭 Suiza", b:"🇨🇦 Canadá", g:"B", v:"Vancouver 🇨🇦", ml:false, sp:false },
  { d:"24 Jun", dow:"Mié", h:"15:00", esp:"21:00", a:"UEFA Playoff A", b:"🇶🇦 Qatar", g:"B", v:"Seattle", ml:false, sp:false },
  { d:"24 Jun", dow:"Mié", h:"18:00", esp:"00:00+1", a:"🏴󠁧󠁢󠁳󠁣󠁴󠁿 Escocia", b:"🇧🇷 Brasil", g:"C", v:"Miami", ml:false, sp:false },
  { d:"24 Jun", dow:"Mié", h:"18:00", esp:"00:00+1", a:"🇲🇦 Marruecos", b:"🇭🇹 Haití", g:"C", v:"Atlanta", ml:false, sp:false },
  { d:"24 Jun", dow:"Mié", h:"21:00", esp:"03:00+1", a:"UEFA Playoff D", b:"🇲🇽 México", g:"A", v:"México DF 🇲🇽", ml:false, sp:false },
  { d:"24 Jun", dow:"Mié", h:"21:00", esp:"03:00+1", a:"🇿🇦 Sudáfrica", b:"🇰🇷 Corea del Sur", g:"A", v:"Monterrey 🇲🇽", ml:false, sp:false },
  { d:"25 Jun", dow:"Jue", h:"16:00", esp:"22:00", a:"🇪🇨 Ecuador", b:"🇩🇪 Alemania", g:"E", v:"🏟️ MetLife", ml:true, sp:false },
  { d:"25 Jun", dow:"Jue", h:"16:00", esp:"22:00", a:"🇨🇼 Curaçao", b:"🇨🇮 Costa de Marfil", g:"E", v:"Philadelphia", ml:false, sp:false },
  { d:"25 Jun", dow:"Jue", h:"19:00", esp:"01:00+1", a:"🇯🇵 Japón", b:"UEFA Playoff B", g:"F", v:"Dallas", ml:false, sp:false },
  { d:"25 Jun", dow:"Jue", h:"19:00", esp:"01:00+1", a:"🇹🇳 Túnez", b:"🇳🇱 Países Bajos", g:"F", v:"Kansas City", ml:false, sp:false },
  { d:"25 Jun", dow:"Jue", h:"22:00", esp:"04:00+1", a:"UEFA Playoff C", b:"🇺🇸 EE.UU.", g:"D", v:"Los Ángeles", ml:false, sp:false },
  { d:"25 Jun", dow:"Jue", h:"22:00", esp:"04:00+1", a:"🇵🇾 Paraguay", b:"🇦🇺 Australia", g:"D", v:"San Francisco", ml:false, sp:false },
  { d:"26 Jun", dow:"Vie", h:"15:00", esp:"21:00", a:"🇳🇴 Noruega", b:"🇫🇷 Francia", g:"I", v:"Boston", ml:false, sp:false },
  { d:"26 Jun", dow:"Vie", h:"15:00", esp:"21:00", a:"🇸🇳 Senegal", b:"IC Playoff 2", g:"I", v:"Toronto", ml:false, sp:false },
  { d:"26 Jun", dow:"Vie", h:"20:00", esp:"02:00+1", a:"🇨🇻 Cabo Verde", b:"🇸🇦 Arabia Saudí", g:"H", v:"Houston", ml:false, sp:false },
  { d:"26 Jun", dow:"Vie", h:"20:00", esp:"02:00+1", a:"🇺🇾 Uruguay", b:"🇪🇸 ESPAÑA", g:"H", v:"Guadalajara 🇲🇽", ml:false, sp:true },
  { d:"26 Jun", dow:"Vie", h:"23:00", esp:"05:00+1", a:"🇪🇬 Egipto", b:"🇮🇷 Irán", g:"G", v:"Seattle", ml:false, sp:false },
  { d:"26 Jun", dow:"Vie", h:"23:00", esp:"05:00+1", a:"🇳🇿 N. Zelanda", b:"🇧🇪 Bélgica", g:"G", v:"Vancouver 🇨🇦", ml:false, sp:false },
  { d:"27 Jun", dow:"Sáb", h:"17:00", esp:"23:00", a:"🇵🇦 Panamá", b:"🏴󠁧󠁢󠁥󠁮󠁧󠁿 Inglaterra", g:"L", v:"🏟️ MetLife", ml:true, sp:false },
  { d:"27 Jun", dow:"Sáb", h:"17:00", esp:"23:00", a:"🇭🇷 Croacia", b:"🇬🇭 Ghana", g:"L", v:"Philadelphia", ml:false, sp:false },
  { d:"27 Jun", dow:"Sáb", h:"19:30", esp:"01:30+1", a:"IC Playoff 1", b:"🇺🇿 Uzbekistán", g:"K", v:"Atlanta", ml:false, sp:false },
  { d:"27 Jun", dow:"Sáb", h:"19:30", esp:"01:30+1", a:"🇨🇴 Colombia", b:"🇵🇹 Portugal", g:"K", v:"Miami", ml:false, sp:false },
  { d:"27 Jun", dow:"Sáb", h:"22:00", esp:"04:00+1", a:"🇯🇴 Jordania", b:"🇦🇷 Argentina", g:"J", v:"Dallas", ml:false, sp:false },
  { d:"27 Jun", dow:"Sáb", h:"22:00", esp:"04:00+1", a:"🇩🇿 Argelia", b:"🇦🇹 Austria", g:"J", v:"Kansas City", ml:false, sp:false },
  { d:"28 Jun", dow:"Dom", h:"15:00", esp:"21:00", a:"2º Grupo A", b:"2º Grupo B", g:"R32", v:"Los Ángeles", ml:false, sp:false },
  { d:"29 Jun", dow:"Lun", h:"13:00", esp:"19:00", a:"1º Grupo C", b:"2º Grupo F", g:"R32", v:"Houston", ml:false, sp:false },
  { d:"29 Jun", dow:"Lun", h:"16:30", esp:"22:30", a:"1º Grupo E", b:"3º A/B/C/D/F", g:"R32", v:"Boston", ml:false, sp:false },
  { d:"29 Jun", dow:"Lun", h:"21:00", esp:"03:00+1", a:"1º Grupo F", b:"2º Grupo C", g:"R32", v:"Monterrey 🇲🇽", ml:false, sp:false },
  { d:"30 Jun", dow:"Mar", h:"13:00", esp:"19:00", a:"2º Grupo E", b:"2º Grupo I", g:"R32", v:"Dallas", ml:false, sp:false },
  { d:"30 Jun", dow:"Mar", h:"17:00", esp:"23:00", a:"1º Grupo I", b:"3º C/D/F/G/H", g:"R32", v:"🏟️ MetLife", ml:true, sp:false },
  { d:"30 Jun", dow:"Mar", h:"21:00", esp:"03:00+1", a:"1º Grupo A", b:"3º C/E/F/H/I", g:"R32", v:"México DF 🇲🇽", ml:false, sp:false },
  { d:"1 Jul", dow:"Mié", h:"12:00", esp:"18:00", a:"1º Grupo L", b:"3º E/H/I/J/K", g:"R32", v:"Atlanta", ml:false, sp:false },
  { d:"1 Jul", dow:"Mié", h:"16:00", esp:"22:00", a:"1º Grupo G", b:"3º A/E/H/I/J", g:"R32", v:"Seattle", ml:false, sp:false },
  { d:"1 Jul", dow:"Mié", h:"20:00", esp:"02:00+1", a:"1º Grupo D", b:"3º B/E/F/I/J", g:"R32", v:"San Francisco", ml:false, sp:false },
];

const WC_DAYS = ["20 Jun","21 Jun","22 Jun","23 Jun","24 Jun","25 Jun","26 Jun","27 Jun","28 Jun","29 Jun","30 Jun","1 Jul"];
const WC_TRIP_NOTES = {
  "20 Jun":"✈️ Llegada JFK 14:45",
  "21 Jun":"🇪🇸 España juega! (TV)",
  "26 Jun":"🇪🇸 España vs Uruguay (TV)",
  "28 Jun":"🏳️‍🌈 Pride NYC",
  "30 Jun":"🏟️ Eliminatoria en MetLife",
  "1 Jul":"✈️ Vuelo vuelta 16:45"
};

function WorldCupTab() {
  const [filter, setFilter] = useState("all");
  const [openDay, setOpenDay] = useState(null);

  const filters = [
    { id:"all", l:"Todos" },
    { id:"spain", l:"🇪🇸 España" },
    { id:"metlife", l:"🏟️ MetLife" },
    { id:"groups", l:"Grupos" },
    { id:"ko", l:"Eliminatorias" },
  ];

  const filtered = WC_MATCHES.filter(m => {
    if (filter === "spain") return m.sp;
    if (filter === "metlife") return m.ml;
    if (filter === "groups") return m.g !== "R32";
    if (filter === "ko") return m.g === "R32";
    return true;
  });

  const byDay = {};
  filtered.forEach(m => { if (!byDay[m.d]) byDay[m.d] = []; byDay[m.d].push(m); });

  const spainMatches = WC_MATCHES.filter(m => m.sp);
  const metlifeMatches = WC_MATCHES.filter(m => m.ml);

  return (
    <div style={{ padding:"12px 14px" }}>
      <Title>⚽ Mundial 2026 — Tu Guía</Title>

      <Card style={{ background:`linear-gradient(135deg, #1a0a0a, #2a1515)`, border:`1.5px solid ${C.red}40`, marginBottom:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <span style={{ fontSize:28 }}>🇪🇸</span>
          <div>
            <div style={{ fontWeight:800, fontSize:14, color:C.gold }}>ESPAÑA — Grupo H</div>
            <div style={{ fontSize:10, color:C.muted }}>con Cabo Verde, Arabia Saudí y Uruguay</div>
          </div>
        </div>
        {spainMatches.map((m,i) => {
          const usT = parseMatchTime(m.h);
          const espT = parseMatchTime(m.esp);
          const usDayLabel = usT.nextDay ? ` ${nextDow(m.dow)}` : "";
          const espDayLabel = espT.nextDay ? ` ${nextDow(m.dow)}` : "";
          return (
            <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderTop:i?`1px solid ${C.border}`:"none" }}>
              <div>
                <span style={{ fontSize:11, fontWeight:700, color:C.text }}>{m.a} vs {m.b}</span>
                <div style={{ fontSize:9, color:C.muted }}>{m.d} ({m.dow}) · {m.v}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:13, fontWeight:800, color:C.accent }}>🇺🇸 {usT.time}{usDayLabel}</div>
                <div style={{ fontSize:9, color:C.gold }}>🇪🇸 {espT.time}{espDayLabel}</div>
              </div>
            </div>
          );
        })}
        <div style={{ marginTop:6, padding:"6px 8px", background:`${C.gold}12`, borderRadius:6, fontSize:9, color:C.gold }}>
          ⚠️ España NO juega en NY. Todos sus partidos son en Atlanta y Guadalajara → ver en bares deportivos
        </div>
      </Card>

      <Card style={{ background:`linear-gradient(135deg, #0a1a0a, #152a15)`, border:`1.5px solid ${C.green}40`, marginBottom:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <span style={{ fontSize:28 }}>🏟️</span>
          <div>
            <div style={{ fontWeight:800, fontSize:14, color:C.green }}>MetLife Stadium</div>
            <div style={{ fontSize:10, color:C.muted }}>A 30min en bus/tren desde Jersey City · Final el 19 Jul</div>
          </div>
        </div>
        {metlifeMatches.map((m,i) => {
          const usT = parseMatchTime(m.h);
          const espT = parseMatchTime(m.esp);
          const usDayLabel = usT.nextDay ? ` ${nextDow(m.dow)}` : "";
          const espDayLabel = espT.nextDay ? ` ${nextDow(m.dow)}` : "";
          return (
            <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderTop:i?`1px solid ${C.border}`:"none" }}>
              <div>
                <span style={{ fontSize:11, fontWeight:700, color:C.text }}>{m.a} vs {m.b}</span>
                <div style={{ fontSize:9, color:C.muted }}>{m.d} ({m.dow}) · {m.g === "R32" ? "Eliminatoria" : `Grupo ${m.g}`}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:13, fontWeight:800, color:C.green }}>🇺🇸 {usT.time}{usDayLabel}</div>
                <div style={{ fontSize:9, color:C.gold }}>🇪🇸 {espT.time}{espDayLabel}</div>
              </div>
            </div>
          );
        })}
        <div style={{ marginTop:6, padding:"6px 8px", background:`${C.green}12`, borderRadius:6, fontSize:9, color:C.green }}>
          🎟️ Entradas en fifa.com/tickets · PATH Journal Sq → Hoboken → bus NJ Transit a MetLife
        </div>
      </Card>

      <div style={{ display:"flex", gap:4, marginBottom:10, flexWrap:"wrap" }}>
        {filters.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding:"5px 10px", borderRadius:20, fontSize:10, fontWeight:600, cursor:"pointer",
            border:`1px solid ${filter===f.id?C.accent:C.border}`,
            background:filter===f.id?`${C.accent}20`:"transparent",
            color:filter===f.id?C.accent:C.muted
          }}>{f.l}</button>
        ))}
      </div>

      {WC_DAYS.map(day => {
        const matches = byDay[day];
        if (!matches) return null;
        const note = WC_TRIP_NOTES[day];
        const isOpen = openDay === day || filter !== "all";
        const hasSpain = matches.some(m => m.sp);
        const hasML = matches.some(m => m.ml);

        return (
          <div key={day} style={{ marginBottom:6 }}>
            <button onClick={() => setOpenDay(openDay === day ? null : day)} style={{
              width:"100%", padding:"8px 10px", borderRadius:8, cursor:"pointer",
              border:`1px solid ${hasSpain?C.red:hasML?C.green:C.border}40`,
              background:hasSpain?`${C.red}10`:hasML?`${C.green}08`:`${C.card}`,
              display:"flex", justifyContent:"space-between", alignItems:"center", textAlign:"left"
            }}>
              <div>
                <span style={{ fontSize:13, fontWeight:800, color:hasSpain?C.gold:hasML?C.green:C.text }}>{day}</span>
                <span style={{ fontSize:10, color:C.muted, marginLeft:6 }}>({matches[0].dow})</span>
                <span style={{ fontSize:10, color:C.muted, marginLeft:6 }}>· {matches.length} partidos</span>
                {hasSpain && <span style={{ fontSize:10, marginLeft:6 }}>🇪🇸</span>}
                {hasML && <span style={{ fontSize:10, marginLeft:6 }}>🏟️</span>}
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                {note && <span style={{ fontSize:8, color:C.gold, maxWidth:120, textAlign:"right" }}>{note}</span>}
                <span style={{ fontSize:10, color:C.muted }}>{isOpen?"▲":"▼"}</span>
              </div>
            </button>

            {isOpen && (
              <div style={{ marginTop:2 }}>
                {matches.map((m,i) => {
                  const isSp = m.sp;
                  const isMl = m.ml;
                  const isKO = m.g === "R32";
                  const usT = parseMatchTime(m.h);
                  const espT = parseMatchTime(m.esp);
                  const usDayLabel = usT.nextDay ? ` ${nextDow(m.dow)}` : "";
                  const espDayLabel = espT.nextDay ? ` ${nextDow(m.dow)}` : "";
                  return (
                    <div key={i} style={{
                      display:"flex", alignItems:"center", gap:8, padding:"7px 10px", marginBottom:1,
                      background:isSp?`${C.red}12`:isMl?`${C.green}0a`:C.card,
                      borderRadius:6, borderLeft:`3px solid ${isSp?C.red:isMl?C.green:isKO?C.purple:C.border}`
                    }}>
                      <div style={{ minWidth:58, textAlign:"center" }}>
                        <div style={{ fontSize:13, fontWeight:800, color:isSp?C.gold:isMl?C.green:C.accent, lineHeight:1.1 }}>
                          {usT.time}{usDayLabel}
                        </div>
                        <div style={{ fontSize:8, color:C.muted, marginTop:1 }}>🇺🇸 NY</div>
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:11, fontWeight:isSp||isMl?800:600, color:isSp?C.gold:C.text }}>
                          {m.a} <span style={{ color:C.muted, fontSize:9 }}>vs</span> {m.b}
                        </div>
                        <div style={{ fontSize:9, color:C.muted, display:"flex", gap:6, flexWrap:"wrap" }}>
                          <span style={{ color:isKO?C.purple:C.blue }}>{isKO?"⚔️ Eliminatoria":`Grupo ${m.g}`}</span>
                          <span>📍 {m.v}</span>
                        </div>
                      </div>
                      <div style={{ textAlign:"right", minWidth:48 }}>
                        <div style={{ fontSize:10, color:C.gold, fontWeight:700 }}>🇪🇸 {espT.time}{espDayLabel}</div>
                        {isMl && <div style={{ marginTop:2 }}><Badge c={C.green}>IR 🎟️</Badge></div>}
                        {isSp && <div style={{ marginTop:2 }}><Badge c={C.red}>TV 📺</Badge></div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <Card style={{ marginTop:8, background:`${C.accent}08` }}>
        <div style={{ fontSize:10, color:C.muted, lineHeight:1.6 }}>
          <div style={{ fontWeight:700, color:C.accent, marginBottom:4 }}>📌 Info útil</div>
          <div>🇺🇸 <strong>NY</strong> = hora local de Nueva York (Eastern Time)</div>
          <div>🇪🇸 <strong>ESP</strong> = hora española (NY + 6 horas)</div>
          <div>📅 Si la hora pone "Mié" después → el partido empieza esa madrugada (día siguiente)</div>
          <div>🏟️ MetLife está en East Rutherford, NJ — accesible desde Jersey City</div>
          <div>📺 Partidos de España → ver en bares: Legends, Nevada Smiths, Boqueria</div>
          <div>🎟️ Entradas: <strong>fifa.com/tickets</strong></div>
          <div>🔜 Si España pasa 1ª de grupo → juega R32 el <strong>2 Jul en Los Ángeles</strong> (ya no estaréis)</div>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════
const TABS = [
  { id:"home", icon:"🏠", label:"Inicio" },
  { id:"cal", icon:"📅", label:"Calendario" },
  { id:"wc", icon:"⚽", label:"Mundial" },
  { id:"movies", icon:"🎬", label:"Pelis" },
  { id:"events", icon:"🎪", label:"Eventos" },
  { id:"food", icon:"🍕", label:"Comer" },
  { id:"ai", icon:"🤖", label:"Guía IA" },
  { id:"ctrl", icon:"💰", label:"Control" },
];

export default function App() {
  const [tab, setTab] = useState("home");
  const [fxOpen, setFxOpen] = useState(false);
  const gps = useGPS();
  const fx = useExchangeRate();

  return (
    <div style={{ fontFamily:"-apple-system, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif", background:C.bg, color:C.text, minHeight:"100vh", maxWidth:500, margin:"0 auto", paddingBottom:72 }}>
      <div style={{ background:`linear-gradient(145deg, #1a2e44, ${C.bg})`, padding:"14px 16px 10px", borderBottom:`1.5px solid ${C.accent}55`, display:"flex", justifyContent:"space-between", alignItems:"center", gap:6 }}>
        <div style={{ flexShrink:0 }}>
          <h1 style={{ fontSize:18, fontWeight:900, margin:0, background:`linear-gradient(90deg, ${C.accent}, ${C.gold})`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>🗽 ❤️</h1>
          <p style={{ fontSize:9, color:C.muted, margin:0, letterSpacing:2 }}>20 JUN — 1 JUL · 5 VIAJEROS</p>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
          <CurrencyButton fx={fx} open={fxOpen} onToggle={() => setFxOpen(!fxOpen)} />
          <button onClick={gps.active ? gps.stop : gps.start} style={{
            padding:"6px 10px", borderRadius:8, border:`1px solid ${gps.active?C.green:C.border}`,
            background:gps.active?`${C.green}18`:"transparent", color:gps.active?C.green:C.muted,
            fontSize:10, fontWeight:700, cursor:"pointer"
          }}>
            {gps.active ? "📍 GPS ON" : "📍 GPS"}
          </button>
        </div>
      </div>

      {/* Panel desplegable del conversor (abajo del header) */}
      {fxOpen && <CurrencyPanel fx={fx} />}

      {gps.active && gps.pos && (
        <div style={{ padding:"4px 14px", background:`${C.green}08`, fontSize:10, color:C.green, borderBottom:`1px solid ${C.green}20` }}>
          📍 GPS activo — distancias desde tu ubicación real
        </div>
      )}

      {tab === "home" && <HomeTab setTab={setTab} gps={gps.pos} />}
      {tab === "cal" && <CalendarTab gps={gps.pos} />}
      {tab === "wc" && <WorldCupTab />}
      {tab === "movies" && <MoviesTab gps={gps.pos} />}
      {tab === "events" && <EventsTab gps={gps.pos} />}
      {tab === "food" && <FoodTab gps={gps.pos} />}
      {tab === "ai" && <AITab />}
      {tab === "ctrl" && <ControlTab gps={gps.pos} fx={fx} />}

      <nav style={{ display:"flex", position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:500, background:`${C.bg}f0`, backdropFilter:"blur(20px)", borderTop:`1px solid ${C.border}`, zIndex:999 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex:1, padding:"7px 2px 5px", background:"none", border:"none",
            color:tab===t.id?C.accent:C.muted, fontSize:8, fontWeight:tab===t.id?700:500,
            cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:1,
            borderTop:tab===t.id?`2px solid ${C.accent}`:"2px solid transparent"
          }}>
            <span style={{ fontSize:14 }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}