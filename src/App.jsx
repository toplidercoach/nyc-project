import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════
// SUPABASE CONFIG
// ═══════════════════════════════════════════
const SB_URL = "https://txowjhiaftcqmdewwqpv.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4b3dqaGlhZnRjcW1kZXd3cXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjE5MjgsImV4cCI6MjA5NjQ5NzkyOH0.9uOPxBFhIPqZb1aQ1kz4hOtwjLzVqbHT-ghrw3wk1Gc";
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

const DB = {
  async get(key) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/nyc_sync?key=eq.${key}&select=data,updated_at`, { headers: SB_HEADERS });
      if (!r.ok) throw new Error(r.statusText);
      const rows = await r.json();
      if (rows.length === 0) return null;
      // data is JSONB, PostgREST returns it already parsed
      let d = rows[0].data;
      // Safety: if it's a string (double-encoded), parse it
      if (typeof d === "string") try { d = JSON.parse(d); } catch {}
      return { data: Array.isArray(d) ? d : [], ts: rows[0].updated_at };
    } catch (e) { console.error("DB.get:", e); return null; }
  },
  async set(key, data) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/nyc_sync?key=eq.${key}`, {
        method: "PATCH", headers: { ...SB_HEADERS, Prefer: "return=minimal" },
        body: JSON.stringify({ data: data, updated_at: new Date().toISOString() })
      });
      return r.ok;
    } catch (e) { console.error("DB.set:", e); return false; }
  },
  // Upload a file to Storage bucket "tickets", returns public URL
  async uploadFile(file) {
    try {
      const ext = (file.name || "file").split(".").pop();
      const path = `${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
      const r = await fetch(`${SB_URL}/storage/v1/object/tickets/${path}`, {
        method: "POST",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      if (!r.ok) throw new Error(await r.text());
      return `${SB_URL}/storage/v1/object/public/tickets/${path}`;
    } catch (e) { console.error("uploadFile:", e); return null; }
  }
};

// ═══════════════════════════════════════════
// LOCAL STORAGE (cache/fallback)
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

function DistBadge({ lat, lng, gps }) {
  const d = distInfo(lat, lng, gps);
  const label = gps ? "📍" : "🏠";
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: `${C.blue}15`, color: C.blue }}>{label} {d.km}km</span>
      <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: `${C.gold}15`, color: C.gold }}>🚶{d.walkMin}min</span>
      <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: `${C.green}15`, color: C.green }}>🚕~{d.carMin}min</span>
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

// ═══════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════
const C = {
  bg: "#0c1117", bg2: "#151d28", card: "#1a2433", hover: "#1f2d3d",
  accent: "#f97316", gold: "#fbbf24", red: "#ef4444", green: "#22c55e", blue: "#3b82f6", purple: "#a78bfa", pink: "#ec4899",
  text: "#e8edf3", muted: "#7e8fa3", border: "#243040",
};
const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 16, outline: "none", boxSizing: "border-box" };

// ═══════════════════════════════════════════
// COMMON COMPONENTS
// ═══════════════════════════════════════════
const Card = ({ children, style, onClick }) => <div onClick={onClick} style={{ background: C.card, borderRadius: 12, padding: 16, marginBottom: 10, border: `1px solid ${C.border}`, ...(onClick ? { cursor: "pointer" } : {}), ...style }}>{children}</div>;
const Badge = ({ c, children }) => <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 16, fontSize: 12, fontWeight: 700, background: `${c}18`, color: c, border: `1px solid ${c}35` }}>{children}</span>;
const Title = ({ children, sub }) => <div style={{ marginBottom: 14 }}><div style={{ fontSize: 20, fontWeight: 800 }}>{children}</div>{sub && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{sub}</div>}</div>;

// ═══════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════
const TRAVELERS = [
  { id: "javi", name: "Javi", age: 21, ini: "J", color: "#4FC3F7" },
  { id: "rosa", name: "Rosa", age: 54, ini: "R", color: "#F06292" },
  { id: "paz", name: "Paz", age: 70, ini: "P", color: "#AED581" },
  { id: "viti", name: "Viti", age: 39, ini: "V", color: "#FFB74D" },
  { id: "miguel", name: "Miguel", age: 54, ini: "M", color: "#CE93D8" },
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

// ═══════════════════════════════════════════
// 🏠 HOME TAB
// ═══════════════════════════════════════════
function HomeTab() {
  const [weather, setWeather] = useState(null);
  const [now, setNow] = useState(new Date());

  // Update clock every 30s
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  // Fetch NYC weather + air quality (free API, no key)
  useEffect(() => {
    (async () => {
      try {
        const [wRes, aqRes] = await Promise.all([
          fetch("https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=America%2FNew_York&forecast_days=3"),
          fetch("https://air-quality-api.open-meteo.com/v1/air-quality?latitude=40.71&longitude=-74.01&current=us_aqi,pm2_5")
        ]);
        const [wData, aqData] = await Promise.all([wRes.json(), aqRes.json()]);
        setWeather({ ...wData, aqi: aqData?.current });
      } catch(e) { console.error("Weather:", e); }
    })();
  }, []);

  const departure = new Date("2026-06-20T12:25:00+02:00");
  const diff = departure - now;
  const days = Math.max(0, Math.floor(diff / 864e5));
  const hours = Math.max(0, Math.floor((diff % 864e5) / 36e5));
  const mins = Math.max(0, Math.floor((diff % 36e5) / 6e4));

  const nyTime = now.toLocaleTimeString("es-ES", { timeZone:"America/New_York", hour:"2-digit", minute:"2-digit" });
  const esTime = now.toLocaleTimeString("es-ES", { timeZone:"Europe/Madrid", hour:"2-digit", minute:"2-digit" });

  const wCodes = {0:"☀️ Despejado",1:"🌤️ Poco nuboso",2:"⛅ Nuboso",3:"☁️ Cubierto",45:"🌫️ Niebla",51:"🌧️ Llovizna",61:"🌧️ Lluvia",63:"🌧️ Lluvia mod.",65:"🌧️ Lluvia fuerte",80:"🌦️ Chubascos",95:"⛈️ Tormenta"};
  const aqiLabel = (v) => v <= 50 ? ["🟢 Buena", C.green] : v <= 100 ? ["🟡 Moderada", C.gold] : ["🔴 Mala", C.red];

  return (
    <div style={{ padding: "12px 14px" }}>
      {/* Countdown */}
      <Card style={{ background:`linear-gradient(135deg, ${C.bg2}, ${C.card})`, textAlign:"center", padding:20 }}>
        <div style={{ fontSize:14, color:C.muted, marginBottom:6 }}>✈️ DESPEGUE DESDE MADRID</div>
        {days > 0 ? (
          <div style={{ display:"flex", justifyContent:"center", gap:10 }}>
            {[{v:days,l:"DÍAS",c:C.accent},{v:hours,l:"HORAS",c:C.gold},{v:mins,l:"MIN",c:C.blue}].map((x,i)=>(
              <div key={i} style={{ textAlign:"center", background:`${x.c}12`, borderRadius:12, padding:"10px 16px", border:`1px solid ${x.c}25`, minWidth:65 }}>
                <div style={{ fontSize:30, fontWeight:900, color:x.c }}>{x.v}</div>
                <div style={{ fontSize:10, color:C.muted, letterSpacing:1 }}>{x.l}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize:24, fontWeight:900, color:C.green }}>🗽 ¡ESTÁIS EN NUEVA YORK!</div>
        )}
        <div style={{ display:"flex", justifyContent:"center", gap:16, marginTop:10 }}>
          <div><span style={{ fontSize:11, color:C.muted }}>🇪🇸 España</span><div style={{ fontSize:18, fontWeight:700 }}>{esTime}</div></div>
          <div style={{ color:C.muted, alignSelf:"center" }}>→</div>
          <div><span style={{ fontSize:11, color:C.muted }}>🗽 Nueva York</span><div style={{ fontSize:18, fontWeight:700, color:C.accent }}>{nyTime}</div></div>
        </div>
        <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>6 horas de diferencia</div>
      </Card>

      {/* Weather + Air Quality */}
      {weather?.current && (
        <Card>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:8 }}>🌡️ Tiempo en Nueva York ahora</div>
          <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:8 }}>
            <div style={{ fontSize:36, fontWeight:900, color:C.accent }}>{Math.round(weather.current.temperature_2m)}°C</div>
            <div>
              <div style={{ fontSize:14, fontWeight:600 }}>{wCodes[weather.current.weather_code] || "🌤️"}</div>
              <div style={{ fontSize:12, color:C.muted }}>Sensación: {Math.round(weather.current.apparent_temperature)}°C</div>
              <div style={{ fontSize:12, color:C.muted }}>Humedad: {weather.current.relative_humidity_2m}% · Viento: {Math.round(weather.current.wind_speed_10m)}km/h</div>
            </div>
          </div>
          {/* 3-day forecast */}
          {weather.daily && (
            <div style={{ display:"flex", gap:6 }}>
              {weather.daily.time.map((d,i) => (
                <div key={i} style={{ flex:1, textAlign:"center", padding:"6px 4px", background:`${C.blue}08`, borderRadius:8, border:`1px solid ${C.border}` }}>
                  <div style={{ fontSize:10, color:C.muted }}>{new Date(d).toLocaleDateString("es-ES",{weekday:"short"})}</div>
                  <div style={{ fontSize:14, fontWeight:700 }}>{Math.round(weather.daily.temperature_2m_max[i])}°</div>
                  <div style={{ fontSize:10, color:C.blue }}>{Math.round(weather.daily.temperature_2m_min[i])}°</div>
                  <div style={{ fontSize:9, color:C.muted }}>💧{weather.daily.precipitation_probability_max[i]}%</div>
                </div>
              ))}
            </div>
          )}
          {/* Air quality */}
          {weather.aqi && (
            <div style={{ marginTop:8, padding:"6px 10px", background:`${aqiLabel(weather.aqi.us_aqi)[1]}10`, borderRadius:8, border:`1px solid ${aqiLabel(weather.aqi.us_aqi)[1]}25`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:12, fontWeight:600 }}>🌬️ Calidad del aire</span>
              <span style={{ fontSize:13, fontWeight:700, color:aqiLabel(weather.aqi.us_aqi)[1] }}>{aqiLabel(weather.aqi.us_aqi)[0]} (AQI: {weather.aqi.us_aqi})</span>
            </div>
          )}
        </Card>
      )}

      {/* Key stats */}
      <div style={{ display:"flex", gap:6, marginBottom:10 }}>
        {[{v:"11",l:"NOCHES",c:C.gold},{v:"5",l:"VIAJEROS",c:C.green},{v:"1$≈0.86€",l:"CAMBIO",c:C.blue}].map((x,i)=>(
          <div key={i} style={{ textAlign:"center", background:`${x.c}10`, borderRadius:10, padding:"8px 6px", border:`1px solid ${x.c}20`, flex:1 }}>
            <div style={{ fontSize:18, fontWeight:800, color:x.c }}>{x.v}</div>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:0.5 }}>{x.l}</div>
          </div>
        ))}
      </div>

      <Card>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>✈️ Vuelos · <span style={{ color:C.accent }}>KRLGF</span></div>
        {[["IDA — 20 JUN","IB0211: MAD → JFK","Sale 12:25 · Llega 14:45 T8",C.blue],["VUELTA — 01 JUL","IB0212: JFK → MAD","Sale 16:45 T8 · Llega 02 JUL 06:00",C.accent]].map(([t,r,d,c],i)=>(
          <div key={i} style={{ background:`${c}08`, borderRadius:8, padding:10, marginBottom:i===0?6:0, border:`1px solid ${c}18` }}>
            <div style={{ fontSize:11, fontWeight:700, color:c }}>{t}</div>
            <div style={{ fontSize:14, fontWeight:600, marginTop:1 }}>{r}</div>
            <div style={{ fontSize:12, color:C.muted }}>{d}</div>
          </div>
        ))}
      </Card>
      <Card>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>🏠 Airbnb · Jersey City</div>
        <div style={{ fontSize:14 }}>65 Corbin Ave, NJ 07306</div>
        <div style={{ fontSize:12, color:C.muted }}>Anfitrión: Faria · Check-out: 1 jul 10:00</div>
        <div style={{ fontSize:12, padding:"4px 8px", background:`${C.gold}12`, borderRadius:6, color:C.gold, marginTop:4, display:"inline-block" }}>🚇 PATH: Journal Sq → Manhattan ~20 min</div>
      </Card>
      <Card>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>🛡️ Seguro IMAWAY · 250002H5</div>
        <div style={{ fontSize:13, color:C.muted }}>Médico: <b style={{color:C.green}}>6M €</b> · Anulación: <b>5.000 €</b> · Total: <b>392,87 €</b></div>
        <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>📞 +34 913907318 · 💬 WA: 913907390</div>
      </Card>
      <Card>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>💡 Imprescindible</div>
        <div style={{ fontSize:13, color:C.muted, lineHeight:1.8 }}>
          🛂 <b style={{color:C.text}}>ESTA:</b> 14$/persona · 🔌 <b style={{color:C.text}}>Enchufe:</b> Tipo A/B<br/>
          💳 <b style={{color:C.text}}>Revolut/N26</b> sin comisiones · Propina 15-20%<br/>
          🚇 <b style={{color:C.text}}>MetroCard 7 días:</b> $34 · 🌡️ 25-32°C + humedad
        </div>
      </Card>
    </div>
  );
}

// PATH train stations (Jersey City + Manhattan) - key for this trip
const PATH_STATIONS = [
  { n:"🚆 JSQ (Journal Square)", lat:40.7325, lng:-74.0633, nj:true },
  { n:"🚆 Grove Street", lat:40.7196, lng:-74.0428, nj:true },
  { n:"🚆 Exchange Place", lat:40.7163, lng:-74.0329, nj:true },
  { n:"🚆 Newport", lat:40.7267, lng:-74.0339, nj:true },
  { n:"🚆 Hoboken", lat:40.7349, lng:-74.0291, nj:true },
  { n:"🚇 WTC (World Trade Center)", lat:40.7115, lng:-74.0114, nj:false },
  { n:"🚇 Christopher St", lat:40.7336, lng:-74.0068, nj:false },
  { n:"🚇 9th St", lat:40.7341, lng:-73.9997, nj:false },
  { n:"🚇 14th St", lat:40.7376, lng:-73.9966, nj:false },
  { n:"🚇 23rd St", lat:40.7429, lng:-73.9925, nj:false },
  { n:"🚇 33rd St (Herald Sq)", lat:40.7491, lng:-73.9882, nj:false },
];

// Quick location picker for events
const NYC_PLACES = [
  { n:"📍 Sin ubicación", lat:null, lng:null },
  { n:"🏠 Airbnb Jersey City", lat:40.7282, lng:-74.0776 },
  { n:"🏟️ MetLife Stadium", lat:40.8128, lng:-74.0742 },
  { n:"✈️ JFK Airport", lat:40.6413, lng:-73.7781 },
  { n:"🗽 Estatua Libertad", lat:40.6892, lng:-74.0445 },
  { n:"🌉 Puente Brooklyn", lat:40.7061, lng:-73.9969 },
  { n:"📸 DUMBO", lat:40.7033, lng:-73.9894 },
  { n:"🏦 Financial District", lat:40.7127, lng:-74.0134 },
  { n:"🏙️ Times Square", lat:40.7580, lng:-73.9855 },
  { n:"🌳 Central Park", lat:40.7712, lng:-73.9741 },
  { n:"🎨 MET Museum", lat:40.7794, lng:-73.9632 },
  { n:"🏛️ Museo Hª Natural", lat:40.7813, lng:-73.9740 },
  { n:"🔭 Empire State", lat:40.7484, lng:-73.9857 },
  { n:"🔭 Top of the Rock", lat:40.7587, lng:-73.9787 },
  { n:"🔭 One World/9-11", lat:40.7127, lng:-74.0134 },
  { n:"🔭 Summit/Edge", lat:40.7539, lng:-74.0005 },
  { n:"🌿 High Line", lat:40.7480, lng:-74.0048 },
  { n:"🏪 Chelsea Market", lat:40.7424, lng:-74.0061 },
  { n:"🏫 Grand Central", lat:40.7527, lng:-73.9772 },
  { n:"🎭 Broadway/Theatre", lat:40.7590, lng:-73.9867 },
  { n:"🍕 Little Italy", lat:40.7191, lng:-73.9973 },
  { n:"🥡 Chinatown", lat:40.7158, lng:-73.9970 },
  { n:"🏘️ Greenwich Village", lat:40.7336, lng:-74.0027 },
  { n:"🛍️ SoHo", lat:40.7233, lng:-73.9985 },
  { n:"🏘️ East Village", lat:40.7265, lng:-73.9815 },
  { n:"🏘️ Lower East Side", lat:40.7150, lng:-73.9843 },
  { n:"🏘️ Upper West Side", lat:40.7870, lng:-73.9754 },
  { n:"🏘️ Upper East Side", lat:40.7736, lng:-73.9566 },
  { n:"🏘️ Harlem", lat:40.8116, lng:-73.9465 },
  { n:"🏘️ Midtown", lat:40.7549, lng:-73.9840 },
  { n:"🏘️ Flatiron/Gramercy", lat:40.7395, lng:-73.9903 },
  { n:"🏘️ Williamsburg", lat:40.7081, lng:-73.9571 },
  { n:"🌊 Coney Island", lat:40.5749, lng:-73.9860 },
  { n:"⚾ Yankee Stadium", lat:40.8296, lng:-73.9262 },
  { n:"🔋 Battery Park", lat:40.7033, lng:-74.0170 },
  { n:"📍 Otra (pegar coords)", lat:0, lng:0 },
];

// ═══════════════════════════════════════════
// 📅 CALENDAR TAB (EDITABLE + IDEAS)
// ═══════════════════════════════════════════
function CalendarTab({ gps }) {
  // Safety: ensure arrays even if localStorage/Supabase has corrupted data
  const safeArr = (v, fallback) => { if (Array.isArray(v)) return v; try { const p = typeof v === "string" ? JSON.parse(v) : v; return Array.isArray(p) ? p : fallback; } catch { return fallback; } };

  const [events, setEvents] = useState(() => safeArr(S.get("cal2"), DEFAULT_CAL));
  const [ideas, setIdeas] = useState(() => safeArr(S.get("ideas"), []));
  const [day, setDay] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ t:"", s:"09:00", e:"11:00", c:C.accent, startLat:null, startLng:null, startLoc:"", endLat:null, endLng:null, endLoc:"", attachments:[] });
  const [moving, setMoving] = useState(null);
  const [showIdeas, setShowIdeas] = useState(false);
  const [ideaText, setIdeaText] = useState("");
  const [scheduleIdea, setScheduleIdea] = useState(null);
  const [syncStatus, setSyncStatus] = useState("loading");
  // Address search dropdown state
  const [searchStart, setSearchStart] = useState({ q:"", results:[], loading:false });
  const [searchEnd, setSearchEnd] = useState({ q:"", results:[], loading:false });
  const [uploading, setUploading] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [viewTickets, setViewTickets] = useState(null);
  const [pickTarget, setPickTarget] = useState("start"); // "start" or "end" — which field the quick buttons fill
  const ticketFileRef = useRef(null);
  const saveTimer = useRef(null);
  const pollTimer = useRef(null);
  const lastRemoteTs = useRef(null);
  const searchTimer = useRef(null);

  // Load from Supabase on mount
  useEffect(() => {
    (async () => {
      try {
        const [remoteEv, remoteId] = await Promise.all([DB.get("events"), DB.get("ideas")]);

        if (remoteEv && Array.isArray(remoteEv.data) && remoteEv.data.length > 0) {
          setEvents(remoteEv.data); S.set("cal2", remoteEv.data);
          lastRemoteTs.current = remoteEv.ts;
        } else {
          const local = safeArr(S.get("cal2"), DEFAULT_CAL);
          setEvents(local);
          await DB.set("events", local);
          lastRemoteTs.current = new Date().toISOString();
        }

        if (remoteId && Array.isArray(remoteId.data) && remoteId.data.length > 0) {
          setIdeas(remoteId.data); S.set("ideas", remoteId.data);
        }

        setSyncStatus(remoteEv !== null ? "synced" : "offline");
      } catch(e) {
        console.error("Sync load error:", e);
        setSyncStatus("offline");
      }
    })();
  }, []);

  // Poll Supabase every 6s
  useEffect(() => {
    pollTimer.current = setInterval(async () => {
      if (syncStatus === "saving") return;
      try {
        const [remoteEv, remoteId] = await Promise.all([DB.get("events"), DB.get("ideas")]);
        if (remoteEv && remoteEv.ts !== lastRemoteTs.current && Array.isArray(remoteEv.data) && remoteEv.data.length > 0) {
          lastRemoteTs.current = remoteEv.ts;
          setEvents(remoteEv.data); S.set("cal2", remoteEv.data);
        }
        if (remoteId && Array.isArray(remoteId.data) && remoteId.data.length > 0) {
          setIdeas(remoteId.data); S.set("ideas", remoteId.data);
        }
        if (remoteEv !== null) setSyncStatus("synced");
      } catch(e) { console.error("Poll error:", e); }
    }, 6000);
    return () => clearInterval(pollTimer.current);
  }, [syncStatus]);

  // Debounced save
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    S.set("cal2", events); S.set("ideas", ideas);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSyncStatus("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        const clean = (Array.isArray(events) ? events : []).map(({ addr, searching, geoResult, geoError, ...rest }) => rest);
        const [okE, okI] = await Promise.all([DB.set("events", clean), DB.set("ideas", ideas)]);
        if (okE) lastRemoteTs.current = new Date().toISOString();
        setSyncStatus(okE && okI ? "synced" : "offline");
      } catch(e) { console.error("Save error:", e); setSyncStatus("offline"); }
    }, 1000);
  }, [events, ideas]);

  const evts = Array.isArray(events) ? events : DEFAULT_CAL;
  const ids = Array.isArray(ideas) ? ideas : [];
  const dayEvt = evts.filter(ev => ev.day === day).sort((a,b) => (a.s||"").localeCompare(b.s||""));
  const nextId = Math.max(0, ...evts.map(ev => ev.id || 0), ...ids.map(x => x.id || 0)) + 1;
  const overlap = (s, e, skip) => dayEvt.some(ev => ev.id !== skip && s < ev.e && e > ev.s);

  const save = () => {
    if (!form.t.trim()) return;
    const data = {
      t:form.t, s:form.s, e:form.e, c:form.c,
      startLat:form.startLat, startLng:form.startLng, startLoc:form.startLoc,
      endLat:form.endLat, endLng:form.endLng, endLoc:form.endLoc,
      attachments: form.attachments || []
    };
    if (editing !== null) {
      setEvents(events.map(ev => ev.id === editing ? { ...ev, ...data } : ev));
      setEditing(null);
    } else {
      setEvents([...events, { ...data, id:nextId, day }]);
    }
    resetForm();
    setAdding(false);
  };

  const resetForm = () => {
    setForm({ t:"", s:"09:00", e:"11:00", c:C.accent, startLat:null, startLng:null, startLoc:"", endLat:null, endLng:null, endLoc:"", attachments:[] });
    setSearchStart({ q:"", results:[], loading:false });
    setSearchEnd({ q:"", results:[], loading:false });
    setLinkInput("");
  };

  const startEdit = (ev) => {
    if (ev.f) return;
    setMoving(null);
    setForm({
      t:ev.t, s:ev.s, e:ev.e, c:ev.c||C.accent,
      startLat:ev.startLat||ev.lat||null, startLng:ev.startLng||ev.lng||null, startLoc:ev.startLoc||ev.loc||"",
      endLat:ev.endLat||null, endLng:ev.endLng||null, endLoc:ev.endLoc||"",
      attachments: ev.attachments || []
    });
    setSearchStart({ q:ev.startLoc||ev.loc||"", results:[], loading:false });
    setSearchEnd({ q:ev.endLoc||"", results:[], loading:false });
    setLinkInput("");
    setEditing(ev.id);
    setAdding(true);
  };

  const cancel = () => { setAdding(false); setEditing(null); resetForm(); };

  // Upload a ticket file
  const uploadTicket = async (file) => {
    setUploading(true);
    const url = await DB.uploadFile(file);
    if (url) {
      const isImg = (file.type||"").startsWith("image/");
      setForm(f => ({ ...f, attachments:[...(f.attachments||[]), { name:file.name||"Adjunto", url, type:isImg?"image":"pdf" }] }));
    }
    setUploading(false);
  };

  // Add a link attachment
  const addLink = () => {
    const u = linkInput.trim();
    if (!u) return;
    const url = u.startsWith("http") ? u : `https://${u}`;
    setForm(f => ({ ...f, attachments:[...(f.attachments||[]), { name:"🔗 Enlace", url, type:"link" }] }));
    setLinkInput("");
  };

  const removeAttachment = (idx) => setForm(f => ({ ...f, attachments:f.attachments.filter((_,i)=>i!==idx) }));

  // Fill start or end location from a quick button, based on pickTarget
  const fillLocation = (p) => {
    if (pickTarget === "end") {
      setForm(f => ({ ...f, endLat:p.lat, endLng:p.lng, endLoc:p.n }));
      setSearchEnd({ q:p.n, results:[], loading:false });
    } else {
      setForm(f => ({ ...f, startLat:p.lat, startLng:p.lng, startLoc:p.n }));
      setSearchStart({ q:p.n, results:[], loading:false });
    }
  };

  // Address search with dropdown (Nominatim, biased to NYC area)
  const doSearch = (query, which) => {
    const setSearch = which === "start" ? setSearchStart : setSearchEnd;
    setSearch(s => ({ ...s, q:query, loading:true }));
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim() || query.length < 3) { setSearch(s => ({ ...s, results:[], loading:false })); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        // Bounding box around NYC + Jersey City: viewbox=west,north,east,south
        const vb = "-74.30,40.92,-73.70,40.55";
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&addressdetails=1&viewbox=${vb}&bounded=1&countrycodes=us`;
        const res = await fetch(url, { headers: { "Accept-Language": "es" } });
        const data = await res.json();
        const results = data.map(r => ({
          name: r.display_name.split(",").slice(0,3).join(","),
          full: r.display_name,
          lat: parseFloat(r.lat), lng: parseFloat(r.lon)
        }));
        setSearch(s => ({ ...s, results, loading:false }));
      } catch(e) { setSearch(s => ({ ...s, results:[], loading:false })); }
    }, 500);
  };

  const pickAddress = (r, which) => {
    if (which === "start") {
      setForm(f => ({ ...f, startLat:r.lat, startLng:r.lng, startLoc:r.name }));
      setSearchStart({ q:r.name, results:[], loading:false });
    } else {
      setForm(f => ({ ...f, endLat:r.lat, endLng:r.lng, endLoc:r.name }));
      setSearchEnd({ q:r.name, results:[], loading:false });
    }
  };

  // Move event to another day
  const moveToDay = (evId, targetDay) => {
    setEvents(events.map(ev => ev.id === evId ? { ...ev, day: targetDay } : ev));
    setMoving(null);
  };

  // Send event to ideas (unschedule)
  const sendToIdeas = (ev) => {
    setIdeas([...ideas, { id: nextId, t: ev.t, c: ev.c || C.accent, from: DAY_LABELS[ev.day] }]);
    setEvents(events.filter(x => x.id !== ev.id));
  };

  // Schedule idea to current day
  const scheduleIdeaToDay = (ideaIdx, targetDay) => {
    const idea = ideas[ideaIdx];
    setEvents([...events, { id: nextId, day: targetDay, t: idea.t, s:"10:00", e:"11:30", c: idea.c || C.gold }]);
    setIdeas(ideas.filter((_, i) => i !== ideaIdx));
    setScheduleIdea(null);
  };

  // Add idea
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

  // Swap time slots between two events (for reordering)
  const swapOrder = (evId, direction) => {
    const sorted = [...dayEvt];
    const idx = sorted.findIndex(e => e.id === evId);
    const targetIdx = idx + direction; // -1 for up, +1 for down
    if (targetIdx < 0 || targetIdx >= sorted.length) return;
    const a = sorted[idx], b = sorted[targetIdx];
    // Don't swap with fixed events
    if (a.f || b.f) return;
    // Swap their time slots: keep durations, reassign start times
    const durA = duration(a.s, a.e);
    const durB = duration(b.s, b.e);
    // The one going "up" gets the earlier start, the one going "down" gets the later start
    const earlier = direction === -1 ? a : b;
    const later = direction === -1 ? b : a;
    const earlyStart = Math.min(...[a,b].map(x => { const [h,m]=x.s.split(":").map(Number); return h*60+m; }));
    const earlyDur = direction === -1 ? durA : durB;
    const laterDur = direction === -1 ? durB : durA;
    const pad = n => String(n).padStart(2,"0");
    const toTime = mins => `${pad(Math.floor(mins/60))}:${pad(mins%60)}`;
    const newEarlyS = earlyStart;
    const newEarlyE = earlyStart + earlyDur;
    const newLaterS = newEarlyE;
    const newLaterE = newLaterS + laterDur;
    setEvents(events.map(ev => {
      if (ev.id === earlier.id) return { ...ev, s:toTime(newEarlyS), e:toTime(newEarlyE) };
      if (ev.id === later.id) return { ...ev, s:toTime(newLaterS), e:toTime(newLaterE) };
      return ev;
    }));
  };

  return (
    <div style={{ padding: "12px 14px" }}>
      <Title sub="Toca para editar · 📦 mover día · 💡 ideas pendientes">📅 Calendario editable</Title>

      {/* Day selector strip */}
      <div style={{ display:"flex", gap:3, overflowX:"auto", paddingBottom:8, marginBottom:8 }}>
        {DAY_LABELS.map((d,i) => {
          const hasEvts = events.some(ev => ev.day === i);
          return (
            <button key={i} onClick={() => { setDay(i); setMoving(null); }} style={{ padding:"5px 8px", borderRadius:7, border:`1px solid ${day===i?C.accent:C.border}`, background:day===i?`${C.accent}18`:"transparent", color:day===i?C.accent:C.muted, fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0, position:"relative" }}>
              {d}
              {hasEvts && <span style={{ position:"absolute", top:-2, right:-2, width:5, height:5, borderRadius:"50%", background:C.accent }} />}
            </button>
          );
        })}
      </div>

      {/* Day title + sync status + ideas toggle */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ fontSize:17, fontWeight:800 }}>{DAY_TITLES[day]} · {DAY_LABELS[day]}</div>
          <span style={{ fontSize:10, padding:"2px 6px", borderRadius:4,
            background: syncStatus==="synced"?`${C.green}15`:syncStatus==="saving"?`${C.gold}15`:syncStatus==="loading"?`${C.blue}15`:`${C.red}15`,
            color: syncStatus==="synced"?C.green:syncStatus==="saving"?C.gold:syncStatus==="loading"?C.blue:C.red
          }}>{syncStatus==="synced"?"☁️ Sync":syncStatus==="saving"?"💾...":syncStatus==="loading"?"⏳":"📴 Local"}</span>
        </div>
        <button onClick={() => setShowIdeas(!showIdeas)} style={{
          padding:"4px 10px", borderRadius:14, fontSize:12, fontWeight:700, cursor:"pointer",
          border:`1px solid ${C.gold}50`, background:showIdeas?`${C.gold}20`:`${C.gold}08`,
          color:C.gold, position:"relative"
        }}>
          💡 Ideas {ideas.length > 0 && <span style={{ background:C.gold, color:"#000", borderRadius:8, padding:"0 5px", fontSize:9, fontWeight:800, marginLeft:3 }}>{ideas.length}</span>}
        </button>
      </div>

      {/* IDEAS / PENDIENTES PANEL */}
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
              {/* Day picker for scheduling this idea */}
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

          {/* Add idea input */}
          <div style={{ display:"flex", gap:4, marginTop:6 }}>
            <input style={{ ...inputStyle, flex:1, fontSize:12 }} placeholder="Ej: Dakota Building (Lennon), café Birch..." value={ideaText} onChange={e => setIdeaText(e.target.value)} onKeyDown={e => e.key === "Enter" && addIdea()} />
            <button onClick={addIdea} style={{ padding:"8px 14px", borderRadius:8, border:"none", background:C.gold, color:"#000", fontWeight:700, fontSize:12, cursor:"pointer" }}>+</button>
          </div>
        </Card>
      )}

      {/* EVENT LIST */}
      {dayEvt.length === 0 && <div style={{ fontSize:12, color:C.muted, textAlign:"center", padding:20 }}>Sin eventos. Pulsa ➕</div>}

      {dayEvt.map((ev, evIdx) => {
        const dur = duration(ev.s, ev.e);
        const hasOverlap = overlap(ev.s, ev.e, ev.id);
        const isMoving = moving === ev.id;
        const canUp = evIdx > 0 && !ev.f && !dayEvt[evIdx-1].f;
        const canDown = evIdx < dayEvt.length - 1 && !ev.f && !dayEvt[evIdx+1].f;
        // This event's start point (fallback to old single loc field)
        const evStart = ev.startLat ? { lat:ev.startLat, lng:ev.startLng } : (ev.lat ? { lat:ev.lat, lng:ev.lng } : null);
        const evStartLoc = ev.startLoc || ev.loc || "";
        const evEnd = ev.endLat ? { lat:ev.endLat, lng:ev.endLng } : evStart;
        // Previous event's END point (where you were left off)
        const prevEv = evIdx > 0 ? dayEvt[evIdx - 1] : null;
        const prevEnd = prevEv ? (prevEv.endLat ? { lat:prevEv.endLat, lng:prevEv.endLng } : (prevEv.startLat ? { lat:prevEv.startLat, lng:prevEv.startLng } : (prevEv.lat ? { lat:prevEv.lat, lng:prevEv.lng } : null))) : null;
        const fromPt = prevEnd || HOME;
        const fromLabel = prevEnd ? "↑ fin anterior" : "🏠 Airbnb";
        // Distance from previous end → this start
        const dist = evStart ? distInfo(evStart.lat, evStart.lng, fromPt) : null;
        const mapsUrl = evStart ? `https://www.google.com/maps/dir/${fromPt.lat},${fromPt.lng}/${evStart.lat},${evStart.lng}/@${evStart.lat},${evStart.lng},14z/data=!3m1!4b1!4m2!4m1!3e2` : null;
        return (
          <div key={ev.id} style={{ marginBottom:6 }}>
            {/* Distance connector from previous */}
            {dist && evIdx > 0 && (
              <div style={{ marginLeft:54, display:"flex", alignItems:"center", gap:6, padding:"3px 8px", marginBottom:2 }}>
                <div style={{ width:1, height:12, background:`${C.muted}30` }} />
                <span style={{ fontSize:10, color:C.blue }}>🚶 {dist.km}km · {dist.walkMin}min</span>
                <span style={{ fontSize:9, color:C.muted }}>desde {fromLabel}</span>
              </div>
            )}
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ width:46, flexShrink:0, textAlign:"right", paddingTop:4, display:"flex", flexDirection:"column", alignItems:"flex-end", gap:0 }}>
                {!ev.f && <button onClick={() => swapOrder(ev.id, -1)} disabled={!canUp} style={{ background:"none", border:"none", fontSize:10, cursor:canUp?"pointer":"default", color:canUp?C.accent:`${C.muted}30`, padding:"0 2px", lineHeight:1 }}>▲</button>}
                <div style={{ fontSize:14, fontWeight:700, color:ev.c||C.accent }}>{ev.s}</div>
                <div style={{ fontSize:12, color:C.muted }}>{ev.e}</div>
                <div style={{ fontSize:10, color:C.muted }}>{dur}min</div>
                {!ev.f && <button onClick={() => swapOrder(ev.id, 1)} disabled={!canDown} style={{ background:"none", border:"none", fontSize:10, cursor:canDown?"pointer":"default", color:canDown?C.accent:`${C.muted}30`, padding:"0 2px", lineHeight:1 }}>▼</button>}
              </div>
              <div onClick={() => !isMoving && startEdit(ev)} style={{ flex:1, borderLeft:`3px solid ${ev.c||C.accent}`, borderRadius:"0 8px 8px 0", padding:"8px 10px", background:`${ev.c||C.accent}0a`, border:`1px solid ${ev.c||C.accent}18`, position:"relative", cursor:ev.f?"default":"pointer" }}>
                <div style={{ fontSize:15, fontWeight:600, paddingRight:ev.f?18:50 }}>{ev.t}</div>
                {/* Location names: start and end */}
                {evStartLoc && <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>📍 {evStartLoc}{ev.endLoc && ev.endLoc !== evStartLoc ? ` → 🏁 ${ev.endLoc}` : ""}</div>}
                {hasOverlap && <span style={{ fontSize:9, color:C.red }}>⚠️ Solapamiento</span>}
                {/* Distance + Maps link */}
                {dist && (
                  <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:4, alignItems:"center" }}>
                    <span style={{ fontSize:9, padding:"1px 5px", borderRadius:4, background:`${C.blue}15`, color:C.blue }}>{fromLabel} {dist.km}km</span>
                    <span style={{ fontSize:9, padding:"1px 5px", borderRadius:4, background:`${C.gold}15`, color:C.gold }}>🚶{dist.walkMin}min</span>
                    <span style={{ fontSize:9, padding:"1px 5px", borderRadius:4, background:`${C.green}15`, color:C.green }}>🚕~{dist.carMin}min</span>
                    {mapsUrl && <a href={mapsUrl} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} style={{ fontSize:9, padding:"1px 5px", borderRadius:4, background:`${C.purple}15`, color:C.purple, textDecoration:"none" }}>🗺️ Mapa</a>}
                    {mapsUrl && <a href={mapsUrl.replace("!3e2","!3e3")} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} style={{ fontSize:9, padding:"1px 5px", borderRadius:4, background:`${C.accent}15`, color:C.accent, textDecoration:"none" }}>🚇 Transit</a>}
                  </div>
                )}
                {/* Action buttons */}
                {!ev.f && (
                  <div style={{ position:"absolute", top:5, right:5, display:"flex", gap:2 }}>
                    <button onClick={(e) => { e.stopPropagation(); setMoving(isMoving ? null : ev.id); }} title="Mover día" style={{ background:"none", border:"none", fontSize:11, cursor:"pointer", opacity:0.6, padding:"0 2px" }}>📦</button>
                    <button onClick={(e) => { e.stopPropagation(); sendToIdeas(ev); }} title="A pendientes" style={{ background:"none", border:"none", fontSize:11, cursor:"pointer", opacity:0.6, padding:"0 2px" }}>💡</button>
                    <button onClick={(e) => { e.stopPropagation(); setEvents(events.filter(x => x.id !== ev.id)); }} title="Borrar" style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:11, opacity:0.4, padding:"0 2px" }}>✕</button>
                  </div>
                )}
                {ev.f && <span style={{ position:"absolute", top:6, right:6, fontSize:8, color:C.muted }}>🔒</span>}
                {/* Tickets/attachments button */}
                {ev.attachments && ev.attachments.length > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); setViewTickets(viewTickets === ev.id ? null : ev.id); }} style={{
                    marginTop:6, padding:"4px 10px", borderRadius:6, border:`1px solid ${C.purple}50`, background:`${C.purple}15`,
                    color:C.purple, fontSize:11, fontWeight:700, cursor:"pointer"
                  }}>🎟️ Entradas/Docs ({ev.attachments.length}) {viewTickets === ev.id ? "▲" : "▼"}</button>
                )}
                {/* Attachments panel */}
                {viewTickets === ev.id && ev.attachments && (
                  <div style={{ marginTop:6, display:"flex", flexDirection:"column", gap:4 }} onClick={e => e.stopPropagation()}>
                    {ev.attachments.map((a,i) => (
                      <a key={i} href={a.url} target="_blank" rel="noopener" style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", background:C.card, borderRadius:6, border:`1px solid ${C.border}`, textDecoration:"none", color:C.text }}>
                        {a.type === "image" ? <img src={a.url} alt="" style={{ width:36, height:36, borderRadius:4, objectFit:"cover" }} /> : <span style={{ fontSize:20 }}>{a.type === "pdf" ? "📄" : "🔗"}</span>}
                        <span style={{ fontSize:12, flex:1 }}>{a.name}</span>
                        <span style={{ fontSize:10, color:C.purple }}>Abrir ↗</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Move-to-day picker */}
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

      {/* Add event button / form */}
      {!adding ? (
        <button onClick={() => { setAdding(true); setEditing(null); setMoving(null); resetForm(); }} style={{ width:"100%", padding:12, borderRadius:10, border:`1px dashed ${C.accent}50`, background:"transparent", color:C.accent, fontSize:13, fontWeight:700, cursor:"pointer", marginTop:8 }}>➕ Añadir evento</button>
      ) : (
        <Card style={{ borderColor:`${C.accent}50`, marginTop:8 }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.accent, marginBottom:6 }}>{editing !== null ? "✏️ Editando evento" : "➕ Nuevo evento"}</div>
          <input style={{ ...inputStyle, marginBottom:6 }} placeholder="¿Qué vas a hacer?" value={form.t} onChange={e => setForm({...form, t:e.target.value})} autoFocus />
          <div style={{ display:"flex", gap:6, marginBottom:6 }}>
            <div style={{ flex:1 }}><label style={{ fontSize:10, color:C.muted }}>Inicio</label><input type="time" style={{ ...inputStyle, fontSize:12 }} value={form.s} onChange={e => setForm({...form, s:e.target.value})} /></div>
            <div style={{ flex:1 }}><label style={{ fontSize:10, color:C.muted }}>Fin</label><input type="time" style={{ ...inputStyle, fontSize:12 }} value={form.e} onChange={e => setForm({...form, e:e.target.value})} /></div>
          </div>
          {form.s && form.e && <div style={{ fontSize:10, color:C.muted, marginBottom:6 }}>⏱ Duración: {duration(form.s, form.e)} minutos</div>}

          {/* START + END Location pickers */}
          <div style={{ marginBottom:8 }}>
            {/* START address */}
            <label style={{ fontSize:11, color:C.muted, fontWeight:600 }}>📍 Dónde empieza (opcional)</label>
            <div style={{ position:"relative", marginBottom:6 }}>
              <input style={{ ...inputStyle, fontSize:13 }} placeholder="Calle, sitio... ej: Times Square, 5th Ave" value={searchStart.q} onChange={e => doSearch(e.target.value, "start")} />
              {searchStart.loading && <span style={{ position:"absolute", right:10, top:14, fontSize:11, color:C.muted }}>⏳</span>}
              {form.startLoc && !searchStart.loading && <button onClick={() => { setForm(f=>({...f, startLat:null, startLng:null, startLoc:""})); setSearchStart({q:"",results:[],loading:false}); }} style={{ position:"absolute", right:8, top:10, background:"none", border:"none", color:C.red, fontSize:12, cursor:"pointer", opacity:0.6 }}>✕</button>}
              {searchStart.results.length > 0 && (
                <div style={{ position:"absolute", zIndex:10, left:0, right:0, maxHeight:160, overflowY:"auto", background:C.card, border:`1px solid ${C.accent}40`, borderRadius:8, marginTop:2, boxShadow:"0 4px 12px rgba(0,0,0,0.4)" }}>
                  {searchStart.results.map((r,i) => (
                    <button key={i} onClick={() => pickAddress(r, "start")} style={{ display:"block", width:"100%", padding:"8px 10px", border:"none", borderBottom:`1px solid ${C.border}30`, background:"transparent", color:C.text, fontSize:12, textAlign:"left", cursor:"pointer" }}>📍 {r.name}</button>
                  ))}
                </div>
              )}
            </div>
            {form.startLoc && <div style={{ fontSize:10, color:C.green, marginBottom:6 }}>✓ Inicio: {form.startLoc}</div>}

            {/* END address */}
            <label style={{ fontSize:11, color:C.muted, fontWeight:600 }}>🏁 Dónde acaba (opcional, si es distinto)</label>
            <div style={{ position:"relative", marginBottom:6 }}>
              <input style={{ ...inputStyle, fontSize:13 }} placeholder="Déjalo vacío si acaba donde empieza" value={searchEnd.q} onChange={e => doSearch(e.target.value, "end")} />
              {searchEnd.loading && <span style={{ position:"absolute", right:10, top:14, fontSize:11, color:C.muted }}>⏳</span>}
              {form.endLoc && !searchEnd.loading && <button onClick={() => { setForm(f=>({...f, endLat:null, endLng:null, endLoc:""})); setSearchEnd({q:"",results:[],loading:false}); }} style={{ position:"absolute", right:8, top:10, background:"none", border:"none", color:C.red, fontSize:12, cursor:"pointer", opacity:0.6 }}>✕</button>}
              {searchEnd.results.length > 0 && (
                <div style={{ position:"absolute", zIndex:10, left:0, right:0, maxHeight:160, overflowY:"auto", background:C.card, border:`1px solid ${C.accent}40`, borderRadius:8, marginTop:2, boxShadow:"0 4px 12px rgba(0,0,0,0.4)" }}>
                  {searchEnd.results.map((r,i) => (
                    <button key={i} onClick={() => pickAddress(r, "end")} style={{ display:"block", width:"100%", padding:"8px 10px", border:"none", borderBottom:`1px solid ${C.border}30`, background:"transparent", color:C.text, fontSize:12, textAlign:"left", cursor:"pointer" }}>🏁 {r.name}</button>
                  ))}
                </div>
              )}
            </div>
            {form.endLoc && <div style={{ fontSize:10, color:C.green, marginBottom:4 }}>✓ Fin: {form.endLoc}</div>}

            {/* Target selector: do quick buttons fill START or END? */}
            <div style={{ marginTop:8, padding:"8px", background:`${C.bg2}`, borderRadius:8, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:11, color:C.muted, marginBottom:6 }}>Atajos rápidos → rellenan:</div>
              <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                <button onClick={() => setPickTarget("start")} style={{ flex:1, padding:"7px", borderRadius:7, border:`1px solid ${pickTarget==="start"?C.accent:C.border}`, background:pickTarget==="start"?`${C.accent}20`:"transparent", color:pickTarget==="start"?C.accent:C.muted, fontSize:12, fontWeight:700, cursor:"pointer" }}>📍 INICIO</button>
                <button onClick={() => setPickTarget("end")} style={{ flex:1, padding:"7px", borderRadius:7, border:`1px solid ${pickTarget==="end"?C.green:C.border}`, background:pickTarget==="end"?`${C.green}20`:"transparent", color:pickTarget==="end"?C.green:C.muted, fontSize:12, fontWeight:700, cursor:"pointer" }}>🏁 FIN</button>
              </div>

              {/* PATH stations */}
              <div style={{ fontSize:10, color:C.blue, fontWeight:700, marginBottom:3 }}>🚆 PATH · Nueva Jersey</div>
              <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginBottom:6 }}>
                {PATH_STATIONS.filter(p => p.nj).map((p,i) => (
                  <button key={i} onClick={() => fillLocation(p)} style={{ padding:"4px 8px", borderRadius:8, border:`1px solid ${C.blue}40`, background:`${C.blue}10`, color:C.blue, fontSize:10, cursor:"pointer" }}>{p.n}</button>
                ))}
              </div>
              <div style={{ fontSize:10, color:C.purple, fontWeight:700, marginBottom:3 }}>🚇 PATH · Manhattan</div>
              <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginBottom:6 }}>
                {PATH_STATIONS.filter(p => !p.nj).map((p,i) => (
                  <button key={i} onClick={() => fillLocation(p)} style={{ padding:"4px 8px", borderRadius:8, border:`1px solid ${C.purple}40`, background:`${C.purple}10`, color:C.purple, fontSize:10, cursor:"pointer" }}>{p.n}</button>
                ))}
              </div>
              {/* Other places */}
              <div style={{ fontSize:10, color:C.muted, fontWeight:700, marginBottom:3 }}>📍 Sitios conocidos</div>
              <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
                {NYC_PLACES.filter(p => p.lat && p.lat !== 0).slice(0,8).map((p,i) => (
                  <button key={i} onClick={() => fillLocation(p)} style={{ padding:"4px 8px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.muted, fontSize:10, cursor:"pointer" }}>{p.n}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Attachments / tickets */}
          <div style={{ marginBottom:8 }}>
            <label style={{ fontSize:11, color:C.muted, fontWeight:600 }}>🎟️ Entradas, bonos, documentos (opcional)</label>
            {/* Existing attachments */}
            {form.attachments && form.attachments.length > 0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:4, marginTop:4, marginBottom:6 }}>
                {form.attachments.map((a,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 8px", background:C.card, borderRadius:6, border:`1px solid ${C.border}` }}>
                    {a.type === "image" ? <img src={a.url} alt="" style={{ width:30, height:30, borderRadius:4, objectFit:"cover" }} /> : <span style={{ fontSize:18 }}>{a.type === "pdf" ? "📄" : "🔗"}</span>}
                    <a href={a.url} target="_blank" rel="noopener" style={{ fontSize:12, flex:1, color:C.purple, textDecoration:"none" }}>{a.name}</a>
                    <button onClick={() => removeAttachment(i)} style={{ background:"none", border:"none", color:C.red, fontSize:12, cursor:"pointer", opacity:0.5 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {/* Upload + link */}
            <div style={{ display:"flex", gap:6, marginTop:4 }}>
              <button onClick={() => ticketFileRef.current?.click()} disabled={uploading} style={{ flex:1, padding:"9px", borderRadius:8, border:`1px solid ${C.purple}40`, background:`${C.purple}12`, color:C.purple, fontSize:12, fontWeight:700, cursor:"pointer" }}>{uploading ? "⏳ Subiendo..." : "📎 Subir foto/PDF"}</button>
              <input ref={ticketFileRef} type="file" accept="image/*,application/pdf" style={{ display:"none" }} onChange={e => { if (e.target.files?.[0]) uploadTicket(e.target.files[0]); e.target.value=""; }} />
            </div>
            <div style={{ display:"flex", gap:6, marginTop:6 }}>
              <input style={{ ...inputStyle, flex:1, fontSize:12 }} placeholder="O pega un link (OneDrive, Drive...)" value={linkInput} onChange={e => setLinkInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addLink()} />
              <button onClick={addLink} style={{ padding:"9px 14px", borderRadius:8, border:"none", background:C.purple, color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>+</button>
            </div>
          </div>

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
        📦 = mover a otro día · 💡 = guardar en Ideas · ▲▼ = reordenar · ✕ = borrar
      </div>
      <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:6 }}>
        <button onClick={() => { if (window.confirm("¿Resetear calendario a los valores originales? Se perderán todos los cambios.")) { setEvents(DEFAULT_CAL); setIdeas([]); }}} style={{ fontSize:9, color:C.red, background:"none", border:`1px solid ${C.red}30`, borderRadius:6, padding:"4px 10px", cursor:"pointer", opacity:0.5 }}>🔄 Resetear calendario</button>
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

            {/* Traveler checks */}
            <div style={{ display:"flex", gap:5, marginTop:8 }} onClick={e => e.stopPropagation()}>
              {TRAVELERS.map(t => {
                const on = checks[`${m.i}-${t.id}`];
                return (
                  <button key={t.id} onClick={() => toggle(m.i, t.id)} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1, padding:"3px 5px", borderRadius:7, border:`1px solid ${on?C.green:C.border}`, background:on?`${C.green}12`:"transparent", cursor:"pointer", minWidth:38 }}>
                    <span style={{ width:22, height:22, borderRadius:"50%", background:on?C.green:t.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color:on?"#fff":"#000" }}>{t.ini}</span>
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
                    <DistBadge lat={sp.lat} lng={sp.lng} gps={gps} />
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
          {e.lat && <DistBadge lat={e.lat} lng={e.lng} gps={gps} />}
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

  return (
    <div style={{ padding: "12px 14px" }}>
      <Title sub="Con distancias desde casa o GPS">🍕 Dónde comer</Title>
      <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:12 }}>
        {[["all","Todos"],["$","Barato"],["$$","Medio"],["$$$","Top"],["🇪🇸","Español"]].map(([k,l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding:"4px 8px", borderRadius:14, border:`1px solid ${filter===k?C.accent:C.border}`, background:filter===k?`${C.accent}18`:"transparent", color:filter===k?C.accent:C.muted, fontSize:10, fontWeight:600, cursor:"pointer" }}>{l}</button>
        ))}
      </div>
      {filtered.map((r,i) => (
        <Card key={i} style={{ borderLeft:r.must?`3px solid ${C.gold}`:undefined }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div><div style={{ fontSize:14, fontWeight:700 }}>{r.name} {r.must && "⭐"}</div><div style={{ fontSize:11, color:C.muted }}>{r.zone}</div></div>
            <div style={{ display:"flex", gap:3 }}><Badge c={C.blue}>{r.type}</Badge><Badge c={priceC[r.price]||C.muted}>{r.price}</Badge></div>
          </div>
          <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>{r.desc}</div>
          {r.lat && <DistBadge lat={r.lat} lng={r.lng} gps={gps} />}
        </Card>
      ))}
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
  const [showKey, setShowKey] = useState(false);
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
// 💰 CONTROL TAB
// ═══════════════════════════════════════════
function ControlTab() {
  const [sub, setSub] = useState("budget");
  const [rate, setRate] = useState(0.86);
  const [rateTime, setRateTime] = useState(null);

  // Fetch live USD→EUR rate
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR");
        const d = await r.json();
        if (d.rates?.EUR) { setRate(d.rates.EUR); setRateTime(d.date); }
      } catch(e) { console.error("Rate fetch:", e); }
    })();
  }, []);
  const [expenses, setExpenses] = useState(() => {
    const saved = S.get("exp");
    return Array.isArray(saved) ? saved : [
      { name:"Vuelos (5 pers)", amount:5050.25, cur:"EUR", cat:"transport", fixed:true },
      { name:"Seguro IMAWAY", amount:392.87, cur:"EUR", cat:"other", fixed:true },
      { name:"Comisión Sequra", amount:147.00, cur:"EUR", cat:"other", fixed:true },
    ];
  });
  const [newN, setNewN] = useState(""); const [newA, setNewA] = useState(""); const [newC, setNewC] = useState("food"); const [newCur, setNewCur] = useState("USD");
  const [filterCat, setFilterCat] = useState("all");
  const [scanning, setScanning] = useState(null); // null, "loading", "done", "error"
  const fileRef = useRef(null);

  // Scan receipt with Claude Vision
  const scanTicket = async (file) => {
    setScanning("loading");
    try {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(",")[1]);
        reader.onerror = () => rej(new Error("Read failed"));
        reader.readAsDataURL(file);
      });
      const mediaType = file.type || "image/jpeg";

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 500,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: "Analiza este ticket/recibo. Responde SOLO con JSON sin markdown: {\"name\":\"descripción corta del gasto (lugar + qué es)\",\"amount\":número total en la moneda original,\"currency\":\"USD o EUR\",\"category\":\"food|transport|tickets|shopping|football|accom|other\"}. Si no puedes leer el importe, pon amount:0. La categoría más probable para restaurantes/cafés es food, para metro/taxi es transport, para museos/atracciones es tickets." }
            ]
          }]
        })
      });
      const data = await response.json();
      const text = data.content?.[0]?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setNewN(parsed.name || "");
      setNewA(parsed.amount ? String(parsed.amount) : "");
      setNewCur(parsed.currency === "EUR" ? "EUR" : "USD");
      setNewC(parsed.category || "food");
      setScanning("done");
      setTimeout(() => setScanning(null), 3000);
    } catch(e) {
      console.error("Scan error:", e);
      setScanning("error");
      setTimeout(() => setScanning(null), 3000);
    }
  };
  const [checklist, setChecklist] = useState(() => {
    const saved = S.get("chk");
    return Array.isArray(saved) ? saved : [
      { t:"✅ Pasaporte Rosa renovado", d:true }, { t:"Tramitar ESTA (14$/pers)", d:false },
      { t:"Seguro ✓", d:true }, { t:"Vuelos ✓", d:true }, { t:"Airbnb ✓", d:true },
      { t:"Adaptadores enchufe", d:false }, { t:"Revolut/N26", d:false },
      { t:"Reservar ferry Libertad", d:false }, { t:"eSIM datos", d:false },
      { t:"Entradas Mundial", d:false }, { t:"Apps: Maps, Citymapper", d:false },
      { t:"Protector solar", d:false }, { t:"Dólares efectivo", d:false },
    ];
  });
  const [notes, setNotes] = useState(() => S.get("notes") || "");
  const [converter, setConverter] = useState({ usd:"", eur:"" });

  useEffect(() => { S.set("exp", expenses); }, [expenses]);
  useEffect(() => { S.set("chk", checklist); }, [checklist]);
  useEffect(() => { S.set("notes", notes); }, [notes]);

  const cats = [{id:"transport",l:"🚇 Transporte",c:C.blue},{id:"food",l:"🍕 Comida",c:C.gold},{id:"tickets",l:"🎟️ Entradas",c:C.purple},{id:"shopping",l:"🛍️ Compras",c:C.pink},{id:"football",l:"⚽ Mundial",c:C.green},{id:"accom",l:"🏠 Alojamiento",c:C.accent},{id:"other",l:"📦 Otros",c:C.muted}];

  // Convert any expense to EUR
  const toEur = (e) => e.cur === "USD" ? e.amount * rate : e.amount;
  const totalEur = expenses.reduce((s,e) => s + toEur(e), 0);
  const totalUsd = expenses.reduce((s,e) => s + (e.cur === "USD" ? e.amount : e.amount / rate), 0);

  // Category totals
  const catTotals = cats.map(cat => ({
    ...cat,
    eur: expenses.filter(e => e.cat === cat.id).reduce((s,e) => s + toEur(e), 0),
    count: expenses.filter(e => e.cat === cat.id).length
  })).filter(c => c.count > 0);

  const addExp = () => {
    if (!newN.trim()||!newA) return;
    setExpenses([...expenses, { name:newN.trim(), amount:parseFloat(newA), cur:newCur, cat:newC }]);
    setNewN(""); setNewA("");
  };

  const filtered = filterCat === "all" ? expenses : expenses.filter(e => e.cat === filterCat);
  const doneN = checklist.filter(c=>c.d).length;

  return (
    <div>
      <div style={{ display:"flex", gap:4, padding:"10px 14px 6px", background:C.bg2 }}>
        {[["budget","💰 Gastos"],["check","✅ Check"],["notes","📝 Notas"]].map(([k,l]) => (
          <button key={k} onClick={() => setSub(k)} style={{ flex:1, padding:"8px", borderRadius:8, border:`1px solid ${sub===k?C.accent:C.border}`, background:sub===k?`${C.accent}18`:"transparent", color:sub===k?C.accent:C.muted, fontSize:13, fontWeight:700, cursor:"pointer" }}>{l}</button>
        ))}
      </div>
      <div style={{ padding:"12px 14px" }}>
        {sub === "budget" && <>
          {/* Totals */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
            <div style={{ background:`${C.accent}12`, borderRadius:10, padding:12, textAlign:"center", border:`1px solid ${C.accent}25` }}>
              <div style={{ fontSize:11, color:C.accent, fontWeight:700 }}>TOTAL</div>
              <div style={{ fontSize:22, fontWeight:900, color:C.accent }}>{totalEur.toFixed(2)} €</div>
              <div style={{ fontSize:11, color:C.muted }}>${totalUsd.toFixed(2)}</div>
            </div>
            <div style={{ background:`${C.green}12`, borderRadius:10, padding:12, textAlign:"center", border:`1px solid ${C.green}25` }}>
              <div style={{ fontSize:11, color:C.green, fontWeight:700 }}>POR PERSONA</div>
              <div style={{ fontSize:22, fontWeight:900, color:C.green }}>{(totalEur/5).toFixed(2)} €</div>
              <div style={{ fontSize:11, color:C.muted }}>${(totalUsd/5).toFixed(2)}</div>
            </div>
          </div>

          {/* Quick converter */}
          <Card style={{ background:`${C.gold}08`, borderColor:`${C.gold}25` }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.gold, marginBottom:6 }}>💱 Conversor · 1$ = {rate.toFixed(4)}€ {rateTime && <span style={{ fontSize:10, fontWeight:400, color:C.muted }}>(BCE {rateTime})</span>}</div>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:11, color:C.muted }}>$ USD</label>
                <input style={{ ...inputStyle, fontSize:16, fontWeight:700 }} type="number" step="0.01" placeholder="0.00" value={converter.usd}
                  onChange={e => setConverter({ usd:e.target.value, eur: e.target.value ? (parseFloat(e.target.value)*rate).toFixed(2) : "" })} />
              </div>
              <span style={{ fontSize:18, color:C.muted, paddingTop:16 }}>→</span>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:11, color:C.muted }}>€ EUR</label>
                <input style={{ ...inputStyle, fontSize:16, fontWeight:700 }} type="number" step="0.01" placeholder="0.00" value={converter.eur}
                  onChange={e => setConverter({ eur:e.target.value, usd: e.target.value ? (parseFloat(e.target.value)/rate).toFixed(2) : "" })} />
              </div>
            </div>
          </Card>

          {/* Category breakdown */}
          <Card>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>📊 Por categoría</div>
            <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:8 }}>
              <button onClick={() => setFilterCat("all")} style={{ padding:"5px 10px", borderRadius:14, fontSize:11, fontWeight:600, cursor:"pointer", border:`1px solid ${filterCat==="all"?C.accent:C.border}`, background:filterCat==="all"?`${C.accent}20`:"transparent", color:filterCat==="all"?C.accent:C.muted }}>Todos</button>
              {catTotals.map(cat => (
                <button key={cat.id} onClick={() => setFilterCat(filterCat===cat.id?"all":cat.id)} style={{ padding:"5px 10px", borderRadius:14, fontSize:11, fontWeight:600, cursor:"pointer", border:`1px solid ${filterCat===cat.id?cat.c:C.border}`, background:filterCat===cat.id?`${cat.c}20`:"transparent", color:filterCat===cat.id?cat.c:C.muted }}>
                  {cat.l.split(" ")[0]} {cat.eur.toFixed(0)}€
                </button>
              ))}
            </div>
            {/* Category bars */}
            {catTotals.map(cat => (
              <div key={cat.id} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <span style={{ fontSize:11, width:20, textAlign:"center" }}>{cat.l.split(" ")[0]}</span>
                <div style={{ flex:1, height:8, borderRadius:4, background:`${C.border}` }}>
                  <div style={{ width:`${Math.min(100,(cat.eur/totalEur)*100)}%`, height:"100%", borderRadius:4, background:cat.c }} />
                </div>
                <span style={{ fontSize:11, fontWeight:700, color:cat.c, minWidth:55, textAlign:"right" }}>{cat.eur.toFixed(0)}€</span>
              </div>
            ))}
          </Card>

          {/* Add expense form */}
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <div style={{ fontSize:13, fontWeight:700 }}>➕ Nuevo gasto</div>
              <button onClick={() => fileRef.current?.click()} disabled={scanning === "loading"} style={{
                padding:"6px 14px", borderRadius:8, border:`1px solid ${C.purple}40`, background:`${C.purple}15`,
                color:C.purple, fontWeight:700, fontSize:12, cursor:"pointer"
              }}>{scanning === "loading" ? "⏳ Leyendo..." : "📸 Foto ticket"}</button>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }}
                onChange={e => { if (e.target.files?.[0]) scanTicket(e.target.files[0]); e.target.value=""; }} />
            </div>
            {scanning === "done" && <div style={{ fontSize:12, color:C.green, padding:"6px 10px", background:`${C.green}10`, borderRadius:6, marginBottom:6 }}>✅ Ticket leído — revisa los datos y dale a Añadir</div>}
            {scanning === "error" && <div style={{ fontSize:12, color:C.red, padding:"6px 10px", background:`${C.red}10`, borderRadius:6, marginBottom:6 }}>❌ No he podido leer el ticket. Mételo manual</div>}
            <input style={{ ...inputStyle, marginBottom:6 }} placeholder="Descripción (ej: Cena pizza Brooklyn)" value={newN} onChange={e => setNewN(e.target.value)} />
            <div style={{ display:"flex", gap:6, marginBottom:6 }}>
              <div style={{ display:"flex", width:"45%", gap:0 }}>
                <select style={{ ...inputStyle, width:"40%", borderRadius:"10px 0 0 10px", fontSize:14, fontWeight:700, padding:"10px 4px", textAlign:"center" }} value={newCur} onChange={e => setNewCur(e.target.value)}>
                  <option value="USD">$</option>
                  <option value="EUR">€</option>
                </select>
                <input style={{ ...inputStyle, width:"60%", borderRadius:"0 10px 10px 0", borderLeft:"none", fontSize:16 }} placeholder="0.00" type="number" step="0.01" value={newA} onChange={e => setNewA(e.target.value)} onKeyDown={e => e.key==="Enter" && addExp()} />
              </div>
              <select style={{ ...inputStyle, width:"55%", fontSize:12 }} value={newC} onChange={e => setNewC(e.target.value)}>{cats.map(c => <option key={c.id} value={c.id}>{c.l}</option>)}</select>
            </div>
            {newA && newCur === "USD" && <div style={{ fontSize:12, color:C.gold, marginBottom:6 }}>💱 {newA}$ = {(parseFloat(newA||0)*rate).toFixed(2)}€</div>}
            <button onClick={addExp} style={{ width:"100%", padding:12, borderRadius:8, border:"none", background:C.accent, color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer" }}>Añadir gasto</button>
          </Card>

          {/* Expense list */}
          {filtered.map((e,i) => {
            const ct = cats.find(c=>c.id===e.cat);
            const origIdx = expenses.indexOf(e);
            return (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 14px", borderBottom:`1px solid ${C.border}`, borderLeft:`3px solid ${ct?.c||C.muted}` }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:600 }}>{e.name}</div>
                  <div style={{ fontSize:11, color:ct?.c }}>{ct?.l}</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6, textAlign:"right" }}>
                  <div>
                    <div style={{ fontSize:15, fontWeight:700 }}>{e.cur === "USD" ? `$${e.amount.toFixed(2)}` : `${e.amount.toFixed(2)}€`}</div>
                    {e.cur === "USD" && <div style={{ fontSize:10, color:C.muted }}>{(e.amount*rate).toFixed(2)}€</div>}
                    {e.cur === "EUR" && <div style={{ fontSize:10, color:C.muted }}>${(e.amount/rate).toFixed(2)}</div>}
                  </div>
                  {!e.fixed && <button onClick={() => setExpenses(expenses.filter((_,j)=>j!==origIdx))} style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:12, opacity:0.5 }}>✕</button>}
                </div>
              </div>
            );
          })}
        </>}
        {sub === "check" && (
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <span style={{ fontSize:15, fontWeight:700 }}>📋 {doneN}/{checklist.length}</span>
              <div style={{ width:80, height:6, borderRadius:3, background:C.border, overflow:"hidden" }}><div style={{ width:`${(doneN/checklist.length)*100}%`, height:"100%", background:C.green, transition:"width .3s" }} /></div>
            </div>
            {checklist.map((item,i) => (
              <div key={i} onClick={() => { const u=[...checklist]; u[i]={...u[i], d:!u[i].d}; setChecklist(u); }} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", cursor:"pointer", borderBottom:`1px solid ${C.border}` }}>
                <div style={{ width:20, height:20, borderRadius:5, border:`2px solid ${item.d?C.green:C.border}`, background:item.d?`${C.green}18`:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:11, color:C.green }}>{item.d && "✓"}</div>
                <span style={{ fontSize:14, color:item.d?C.muted:C.text, textDecoration:item.d?"line-through":"none" }}>{item.t}</span>
              </div>
            ))}
          </Card>
        )}
        {sub === "notes" && (
          <Card><textarea style={{ ...inputStyle, minHeight:250, resize:"vertical", lineHeight:1.6 }} placeholder="Notas, ideas, links..." value={notes} onChange={e => setNotes(e.target.value)} /></Card>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// WORLD CUP TAB
// ═══════════════════════════════════════════
const WC_MATCHES = [
  // June 20 (Sáb) - DÍA DE LLEGADA
  { d:"20 Jun", dow:"Sáb", h:"13:00", esp:"19:00", a:"🇳🇱 Países Bajos", b:"UEFA Playoff B", g:"F", v:"Houston", ml:false, sp:false },
  { d:"20 Jun", dow:"Sáb", h:"16:00", esp:"22:00", a:"🇩🇪 Alemania", b:"🇨🇮 Costa de Marfil", g:"E", v:"Toronto", ml:false, sp:false },
  { d:"20 Jun", dow:"Sáb", h:"20:00", esp:"02:00+1", a:"🇪🇨 Ecuador", b:"🇨🇼 Curaçao", g:"E", v:"Kansas City", ml:false, sp:false },
  { d:"20 Jun", dow:"Sáb", h:"00:00+1", esp:"06:00+1", a:"🇹🇳 Túnez", b:"🇯🇵 Japón", g:"F", v:"Monterrey 🇲🇽", ml:false, sp:false },
  // June 21 (Dom)
  { d:"21 Jun", dow:"Dom", h:"12:00", esp:"18:00", a:"🇪🇸 ESPAÑA", b:"🇸🇦 Arabia Saudí", g:"H", v:"Atlanta", ml:false, sp:true },
  { d:"21 Jun", dow:"Dom", h:"15:00", esp:"21:00", a:"🇧🇪 Bélgica", b:"🇮🇷 Irán", g:"G", v:"Los Ángeles", ml:false, sp:false },
  { d:"21 Jun", dow:"Dom", h:"18:00", esp:"00:00+1", a:"🇺🇾 Uruguay", b:"🇨🇻 Cabo Verde", g:"H", v:"Miami", ml:false, sp:false },
  { d:"21 Jun", dow:"Dom", h:"21:00", esp:"03:00+1", a:"🇳🇿 N. Zelanda", b:"🇪🇬 Egipto", g:"G", v:"Vancouver 🇨🇦", ml:false, sp:false },
  // June 22 (Lun)
  { d:"22 Jun", dow:"Lun", h:"13:00", esp:"19:00", a:"🇦🇷 Argentina", b:"🇦🇹 Austria", g:"J", v:"Dallas", ml:false, sp:false },
  { d:"22 Jun", dow:"Lun", h:"17:00", esp:"23:00", a:"🇫🇷 Francia", b:"IC Playoff 2", g:"I", v:"Philadelphia", ml:false, sp:false },
  { d:"22 Jun", dow:"Lun", h:"20:00", esp:"02:00+1", a:"🇳🇴 Noruega", b:"🇸🇳 Senegal", g:"I", v:"🏟️ MetLife", ml:true, sp:false },
  { d:"22 Jun", dow:"Lun", h:"23:00", esp:"05:00+1", a:"🇯🇴 Jordania", b:"🇩🇿 Argelia", g:"J", v:"San Francisco", ml:false, sp:false },
  // June 23 (Mar)
  { d:"23 Jun", dow:"Mar", h:"13:00", esp:"19:00", a:"🇵🇹 Portugal", b:"🇺🇿 Uzbekistán", g:"K", v:"Houston", ml:false, sp:false },
  { d:"23 Jun", dow:"Mar", h:"16:00", esp:"22:00", a:"🏴󠁧󠁢󠁥󠁮󠁧󠁿 Inglaterra", b:"🇬🇭 Ghana", g:"L", v:"Boston", ml:false, sp:false },
  { d:"23 Jun", dow:"Mar", h:"19:00", esp:"01:00+1", a:"🇵🇦 Panamá", b:"🇭🇷 Croacia", g:"L", v:"Toronto", ml:false, sp:false },
  { d:"23 Jun", dow:"Mar", h:"22:00", esp:"04:00+1", a:"🇨🇴 Colombia", b:"IC Playoff 1", g:"K", v:"Guadalajara 🇲🇽", ml:false, sp:false },
  // June 24 (Mié)
  { d:"24 Jun", dow:"Mié", h:"15:00", esp:"21:00", a:"🇨🇭 Suiza", b:"🇨🇦 Canadá", g:"B", v:"Vancouver 🇨🇦", ml:false, sp:false },
  { d:"24 Jun", dow:"Mié", h:"15:00", esp:"21:00", a:"UEFA Playoff A", b:"🇶🇦 Qatar", g:"B", v:"Seattle", ml:false, sp:false },
  { d:"24 Jun", dow:"Mié", h:"18:00", esp:"00:00+1", a:"🏴󠁧󠁢󠁳󠁣󠁴󠁿 Escocia", b:"🇧🇷 Brasil", g:"C", v:"Miami", ml:false, sp:false },
  { d:"24 Jun", dow:"Mié", h:"18:00", esp:"00:00+1", a:"🇲🇦 Marruecos", b:"🇭🇹 Haití", g:"C", v:"Atlanta", ml:false, sp:false },
  { d:"24 Jun", dow:"Mié", h:"21:00", esp:"03:00+1", a:"UEFA Playoff D", b:"🇲🇽 México", g:"A", v:"México DF 🇲🇽", ml:false, sp:false },
  { d:"24 Jun", dow:"Mié", h:"21:00", esp:"03:00+1", a:"🇿🇦 Sudáfrica", b:"🇰🇷 Corea del Sur", g:"A", v:"Monterrey 🇲🇽", ml:false, sp:false },
  // June 25 (Jue)
  { d:"25 Jun", dow:"Jue", h:"16:00", esp:"22:00", a:"🇪🇨 Ecuador", b:"🇩🇪 Alemania", g:"E", v:"🏟️ MetLife", ml:true, sp:false },
  { d:"25 Jun", dow:"Jue", h:"16:00", esp:"22:00", a:"🇨🇼 Curaçao", b:"🇨🇮 Costa de Marfil", g:"E", v:"Philadelphia", ml:false, sp:false },
  { d:"25 Jun", dow:"Jue", h:"19:00", esp:"01:00+1", a:"🇯🇵 Japón", b:"UEFA Playoff B", g:"F", v:"Dallas", ml:false, sp:false },
  { d:"25 Jun", dow:"Jue", h:"19:00", esp:"01:00+1", a:"🇹🇳 Túnez", b:"🇳🇱 Países Bajos", g:"F", v:"Kansas City", ml:false, sp:false },
  { d:"25 Jun", dow:"Jue", h:"22:00", esp:"04:00+1", a:"UEFA Playoff C", b:"🇺🇸 EE.UU.", g:"D", v:"Los Ángeles", ml:false, sp:false },
  { d:"25 Jun", dow:"Jue", h:"22:00", esp:"04:00+1", a:"🇵🇾 Paraguay", b:"🇦🇺 Australia", g:"D", v:"San Francisco", ml:false, sp:false },
  // June 26 (Vie) - ÚLTIMA JORNADA GRUPO H (ESPAÑA)
  { d:"26 Jun", dow:"Vie", h:"15:00", esp:"21:00", a:"🇳🇴 Noruega", b:"🇫🇷 Francia", g:"I", v:"Boston", ml:false, sp:false },
  { d:"26 Jun", dow:"Vie", h:"15:00", esp:"21:00", a:"🇸🇳 Senegal", b:"IC Playoff 2", g:"I", v:"Toronto", ml:false, sp:false },
  { d:"26 Jun", dow:"Vie", h:"20:00", esp:"02:00+1", a:"🇨🇻 Cabo Verde", b:"🇸🇦 Arabia Saudí", g:"H", v:"Houston", ml:false, sp:false },
  { d:"26 Jun", dow:"Vie", h:"20:00", esp:"02:00+1", a:"🇺🇾 Uruguay", b:"🇪🇸 ESPAÑA", g:"H", v:"Guadalajara 🇲🇽", ml:false, sp:true },
  { d:"26 Jun", dow:"Vie", h:"23:00", esp:"05:00+1", a:"🇪🇬 Egipto", b:"🇮🇷 Irán", g:"G", v:"Seattle", ml:false, sp:false },
  { d:"26 Jun", dow:"Vie", h:"23:00", esp:"05:00+1", a:"🇳🇿 N. Zelanda", b:"🇧🇪 Bélgica", g:"G", v:"Vancouver 🇨🇦", ml:false, sp:false },
  // June 27 (Sáb)
  { d:"27 Jun", dow:"Sáb", h:"17:00", esp:"23:00", a:"🇵🇦 Panamá", b:"🏴󠁧󠁢󠁥󠁮󠁧󠁿 Inglaterra", g:"L", v:"🏟️ MetLife", ml:true, sp:false },
  { d:"27 Jun", dow:"Sáb", h:"17:00", esp:"23:00", a:"🇭🇷 Croacia", b:"🇬🇭 Ghana", g:"L", v:"Philadelphia", ml:false, sp:false },
  { d:"27 Jun", dow:"Sáb", h:"19:30", esp:"01:30+1", a:"IC Playoff 1", b:"🇺🇿 Uzbekistán", g:"K", v:"Atlanta", ml:false, sp:false },
  { d:"27 Jun", dow:"Sáb", h:"19:30", esp:"01:30+1", a:"🇨🇴 Colombia", b:"🇵🇹 Portugal", g:"K", v:"Miami", ml:false, sp:false },
  { d:"27 Jun", dow:"Sáb", h:"22:00", esp:"04:00+1", a:"🇯🇴 Jordania", b:"🇦🇷 Argentina", g:"J", v:"Dallas", ml:false, sp:false },
  { d:"27 Jun", dow:"Sáb", h:"22:00", esp:"04:00+1", a:"🇩🇿 Argelia", b:"🇦🇹 Austria", g:"J", v:"Kansas City", ml:false, sp:false },
  // June 28 (Dom) - OCTAVOS/32avos
  { d:"28 Jun", dow:"Dom", h:"15:00", esp:"21:00", a:"2º Grupo A", b:"2º Grupo B", g:"R32", v:"Los Ángeles", ml:false, sp:false },
  // June 29 (Lun)
  { d:"29 Jun", dow:"Lun", h:"13:00", esp:"19:00", a:"1º Grupo C", b:"2º Grupo F", g:"R32", v:"Houston", ml:false, sp:false },
  { d:"29 Jun", dow:"Lun", h:"16:30", esp:"22:30", a:"1º Grupo E", b:"3º A/B/C/D/F", g:"R32", v:"Boston", ml:false, sp:false },
  { d:"29 Jun", dow:"Lun", h:"21:00", esp:"03:00+1", a:"1º Grupo F", b:"2º Grupo C", g:"R32", v:"Monterrey 🇲🇽", ml:false, sp:false },
  // June 30 (Mar)
  { d:"30 Jun", dow:"Mar", h:"13:00", esp:"19:00", a:"2º Grupo E", b:"2º Grupo I", g:"R32", v:"Dallas", ml:false, sp:false },
  { d:"30 Jun", dow:"Mar", h:"17:00", esp:"23:00", a:"1º Grupo I", b:"3º C/D/F/G/H", g:"R32", v:"🏟️ MetLife", ml:true, sp:false },
  { d:"30 Jun", dow:"Mar", h:"21:00", esp:"03:00+1", a:"1º Grupo A", b:"3º C/E/F/H/I", g:"R32", v:"México DF 🇲🇽", ml:false, sp:false },
  // July 1 (Mié) - DÍA DE VUELTA (vuelo 16:45)
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

      {/* Spain highlight card */}
      <Card style={{ background:`linear-gradient(135deg, #1a0a0a, #2a1515)`, border:`1.5px solid ${C.red}40`, marginBottom:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <span style={{ fontSize:28 }}>🇪🇸</span>
          <div>
            <div style={{ fontWeight:800, fontSize:14, color:C.gold }}>ESPAÑA — Grupo H</div>
            <div style={{ fontSize:10, color:C.muted }}>con Cabo Verde, Arabia Saudí y Uruguay</div>
          </div>
        </div>
        {spainMatches.map((m,i) => (
          <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderTop:i?`1px solid ${C.border}`:"none" }}>
            <div>
              <span style={{ fontSize:11, fontWeight:700, color:C.text }}>{m.a} vs {m.b}</span>
              <div style={{ fontSize:9, color:C.muted }}>{m.d} ({m.dow}) · {m.v}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:13, fontWeight:800, color:C.accent }}>{m.h} ET</div>
              <div style={{ fontSize:9, color:C.gold }}>🇪🇸 {m.esp} ESP</div>
            </div>
          </div>
        ))}
        <div style={{ marginTop:6, padding:"6px 8px", background:`${C.gold}12`, borderRadius:6, fontSize:9, color:C.gold }}>
          ⚠️ España NO juega en NY. Todos sus partidos son en Atlanta y Guadalajara → ver en bares deportivos
        </div>
      </Card>

      {/* MetLife highlight card */}
      <Card style={{ background:`linear-gradient(135deg, #0a1a0a, #152a15)`, border:`1.5px solid ${C.green}40`, marginBottom:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <span style={{ fontSize:28 }}>🏟️</span>
          <div>
            <div style={{ fontWeight:800, fontSize:14, color:C.green }}>MetLife Stadium</div>
            <div style={{ fontSize:10, color:C.muted }}>A 30min en bus/tren desde Jersey City · Final el 19 Jul</div>
          </div>
        </div>
        {metlifeMatches.map((m,i) => (
          <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderTop:i?`1px solid ${C.border}`:"none" }}>
            <div>
              <span style={{ fontSize:11, fontWeight:700, color:C.text }}>{m.a} vs {m.b}</span>
              <div style={{ fontSize:9, color:C.muted }}>{m.d} ({m.dow}) · {m.g === "R32" ? "Eliminatoria" : `Grupo ${m.g}`}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:13, fontWeight:800, color:C.green }}>{m.h} ET</div>
              <div style={{ fontSize:9, color:C.gold }}>🇪🇸 {m.esp} ESP</div>
            </div>
          </div>
        ))}
        <div style={{ marginTop:6, padding:"6px 8px", background:`${C.green}12`, borderRadius:6, fontSize:9, color:C.green }}>
          🎟️ Entradas en fifa.com/tickets · PATH Journal Sq → Hoboken → bus NJ Transit a MetLife
        </div>
      </Card>

      {/* Filters */}
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

      {/* Day-by-day schedule */}
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
                  return (
                    <div key={i} style={{
                      display:"flex", alignItems:"center", gap:8, padding:"7px 10px", marginBottom:1,
                      background:isSp?`${C.red}12`:isMl?`${C.green}0a`:C.card,
                      borderRadius:6, borderLeft:`3px solid ${isSp?C.red:isMl?C.green:isKO?C.purple:C.border}`
                    }}>
                      <div style={{ minWidth:48, textAlign:"center" }}>
                        <div style={{ fontSize:13, fontWeight:800, color:isSp?C.gold:isMl?C.green:C.accent }}>{m.h}</div>
                        <div style={{ fontSize:8, color:C.muted }}>ET</div>
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
                      <div style={{ textAlign:"right", minWidth:44 }}>
                        <div style={{ fontSize:9, color:C.gold }}>{m.esp}</div>
                        <div style={{ fontSize:7, color:C.muted }}>🇪🇸 ESP</div>
                        {isMl && <Badge c={C.green}>IR 🎟️</Badge>}
                        {isSp && <Badge c={C.red}>TV 📺</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Footer info */}
      <Card style={{ marginTop:8, background:`${C.accent}08` }}>
        <div style={{ fontSize:10, color:C.muted, lineHeight:1.6 }}>
          <div style={{ fontWeight:700, color:C.accent, marginBottom:4 }}>📌 Info útil</div>
          <div>🕐 <strong>ET</strong> = Eastern Time (hora de Nueva York)</div>
          <div>🇪🇸 <strong>ESP</strong> = hora española (ET + 6 horas)</div>
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
  const gps = useGPS();

  return (
    <div style={{ fontFamily:"-apple-system, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif", background:C.bg, color:C.text, minHeight:"100vh", maxWidth:500, margin:"0 auto", paddingBottom:72 }}>
      {/* Header */}
      <div style={{ background:`linear-gradient(145deg, #1a2e44, ${C.bg})`, padding:"14px 16px 10px", borderBottom:`1.5px solid ${C.accent}55`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <h1 style={{ fontSize:18, fontWeight:900, margin:0, background:`linear-gradient(90deg, ${C.accent}, ${C.gold})`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>🗽 Nueva York 2026</h1>
          <p style={{ fontSize:9, color:C.muted, margin:0, letterSpacing:2 }}>20 JUN — 1 JUL · 5 VIAJEROS</p>
        </div>
        <button onClick={gps.active ? gps.stop : gps.start} style={{
          padding:"6px 10px", borderRadius:8, border:`1px solid ${gps.active?C.green:C.border}`,
          background:gps.active?`${C.green}18`:"transparent", color:gps.active?C.green:C.muted,
          fontSize:12, fontWeight:700, cursor:"pointer"
        }}>
          {gps.active ? "📍 GPS ON" : "📍 GPS"}
        </button>
      </div>

      {gps.active && gps.pos && (
        <div style={{ padding:"4px 14px", background:`${C.green}08`, fontSize:10, color:C.green, borderBottom:`1px solid ${C.green}20` }}>
          📍 GPS activo — distancias desde tu ubicación real
        </div>
      )}

      {tab === "home" && <HomeTab />}
      {tab === "cal" && <CalendarTab gps={gps.pos} />}
      {tab === "wc" && <WorldCupTab />}
      {tab === "movies" && <MoviesTab gps={gps.pos} />}
      {tab === "events" && <EventsTab gps={gps.pos} />}
      {tab === "food" && <FoodTab gps={gps.pos} />}
      {tab === "ai" && <AITab />}
      {tab === "ctrl" && <ControlTab />}

      {/* Bottom nav */}
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