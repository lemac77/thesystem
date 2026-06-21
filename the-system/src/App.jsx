import { useState, useEffect, useCallback, useRef } from "react";

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
// ─── SUPABASE SYNC ────────────────────────────────────────────────────────────
const getSB = () => {
  try {
    const url = localStorage.getItem("ts_sb_url");
    const key = localStorage.getItem("ts_sb_key");
    if(!url||!key) return null;
    return {url,key};
  } catch { return null; }
};

const sbReq = async (path, opts={}) => {
  const sb = getSB();
  if(!sb) return null;
  try {
    const res = await fetch(`${sb.url}/rest/v1/${path}`, {
      headers: {"apikey":sb.key,"Authorization":`Bearer ${sb.key}`,"Content-Type":"application/json","Prefer":opts.prefer||"return=representation",...(opts.headers||{})},
      method: opts.method||"GET",
      body: opts.body,
    });
    if(!res.ok) return null;
    const t = await res.text();
    return t ? JSON.parse(t) : [];
  } catch { return null; }
};

// ─── SUPABASE SCHEMA WHITELIST ───────────────────────────────────────────────
const SB_SCHEMA = {
  clients:  ["id","name","contact","sector","stage","type","monthly_fee","installments","activity_log","notes","created_at","user_id"],
  goals:    ["id","title","category","target","current","unit","deadline","done","created_at","user_id"],
  ideas:    ["id","raw","refined","category","tags","score","action","created_at","user_id"],
  leads:    ["id","name","contact","sector","stage","source","notes","contacted","created_at","user_id","website"],
  notes:    ["id","text","created_at","time","user_id"],
  payments: ["id","expected_id","client_id","amount","date","note","type","user_id"],
  quests:   ["id","text","done","fixed","user_id"],
  tasks:    ["id","text","done","xp","created_at","done_at","user_id"],
  settings: ["key","value","user_id"],
};

const filterRow = (table, row) => {
  const cols = SB_SCHEMA[table];
  if(!cols) return row;
  // Map camelCase keys to snake_case
  const keyMap = {
    monthlyFee: "monthly_fee",
    activityLog: "activity_log",
    createdAt: "created_at",
    doneAt: "done_at",
    expectedId: "expected_id",
    clientId: "client_id",
    userId: "user_id",
  };
  const normalized = {};
  Object.keys(row).forEach(k => {
    const target = keyMap[k] || k;
    normalized[target] = row[k];
  });
  const out = {};
  cols.forEach(c => { if(normalized[c]!==undefined) out[c] = normalized[c]; });
  return out;
};

const getUID = () => { try { return JSON.parse(localStorage.getItem("ts_auth_user")||"{}").id||"andrea"; } catch { return "andrea"; } };

// Immediate push single item to Supabase
const pushItem = async (table, item) => {
  if(!getSB()) return;
  try {
    const token = await sbAuth.getValidToken();
    if(!token) return;
    const row = filterRow(table, {...item, user_id:getUID()});
    await fetch(`${getSB().url}/rest/v1/${table}?on_conflict=id`, {
      method:"POST",
      headers:{"apikey":getSB().key,"Authorization":`Bearer ${token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify([row])
    });
  } catch(e) { console.error("pushItem failed:", e); }
};

const deleteItem = async (table, id) => {
  if(!getSB()) return;
  try {
    const token = await sbAuth.getValidToken();
    if(!token) return;
    await fetch(`${getSB().url}/rest/v1/${table}?id=eq.${id}`, {
      method:"DELETE",
      headers:{"apikey":getSB().key,"Authorization":`Bearer ${token}`,"Content-Type":"application/json"}
    });
  } catch(e) { console.error("deleteItem failed:", e); }
};

const DB = {
  upsert: async (table, rows) => {
    if(!rows?.length) return;
    await sbReqAuth(table+"?on_conflict=id", {method:"POST", prefer:"return=minimal", headers:{"Prefer":"resolution=merge-duplicates,return=minimal"}, body:JSON.stringify(rows.map(r=>filterRow(table,{...r,user_id:getUID()})))});
  },
  setSetting: async (key, value) => {
    await sbReqAuth("settings", {method:"POST", headers:{"Prefer":"resolution=merge-duplicates,return=minimal"}, body:JSON.stringify({key, value:JSON.stringify(value), user_id:getUID()})});
  },
  getSetting: async (key, def) => {
    const rows = await sbReqAuth(`settings?key=eq.${encodeURIComponent(key)}&user_id=eq.${getUID()}&select=value`);
    if(!rows?.length) return def;
    try { return JSON.parse(rows[0].value); } catch { return def; }
  },
  getAll: async (table, def=[]) => {
    const rows = await sbReqAuth(`${table}?user_id=eq.${getUID()}`);
    return rows||def;
  },
  pushAll: async (s) => {
    if(!getSB()) return;
    await Promise.allSettled([
      DB.upsert("clients",s.clients), DB.upsert("leads",s.leads),
      DB.upsert("quests",s.quests), DB.upsert("tasks",s.tasks),
      DB.upsert("ideas",s.ideas), DB.upsert("goals",s.goals),
      DB.upsert("notes",s.notes), DB.upsert("payments",s.payments),
      DB.setSetting("workout_log",s.workoutLog), DB.setSetting("diet_log",s.dietLog),
      DB.setSetting("mood_log",s.moodLog), DB.setSetting("weight_log",s.weightLog),
      DB.setSetting("habit_log",s.habitLog), DB.setSetting("habits",s.habits),
      DB.setSetting("slot_days",s.slotDays), DB.setSetting("slot_start",s.slotStart),
      DB.setSetting("last_reset",s.lastReset), DB.setSetting("api_keys",s.apiKeys),
      DB.setSetting("smoke_log",s.smokeLog||{}), DB.setSetting("focus_log",s.focusLog||{}),
      DB.setSetting("projects",s.projects||[]),
    ]);
  },
  pullAll: async () => {
    if(!getSB()) return null;
    try {
      const [clients,leads,quests,tasks,ideas,goals,notes,payments,
        workoutLog,dietLog,moodLog,weightLog,habitLog,habits,
        slotDays,slotStart,lastReset,apiKeys,smokeLog,focusLog,projects] = await Promise.all([
        DB.getAll("clients",[]), DB.getAll("leads",[]), DB.getAll("quests",[]),
        DB.getAll("tasks",[]), DB.getAll("ideas",[]), DB.getAll("goals",[]),
        DB.getAll("notes",[]), DB.getAll("payments",[]),
        DB.getSetting("workout_log",{}), DB.getSetting("diet_log",{}),
        DB.getSetting("mood_log",{}), DB.getSetting("weight_log",[]),
        DB.getSetting("habit_log",{}), DB.getSetting("habits",[]),
        DB.getSetting("slot_days",0), DB.getSetting("slot_start",""),
        DB.getSetting("last_reset",""), DB.getSetting("api_keys",{apify:"",anthropic:""}),
        DB.getSetting("smoke_log",{}), DB.getSetting("focus_log",{}),
        DB.getSetting("projects",[]),
      ]);
      return {clients,leads,quests,tasks,ideas,goals,notes,payments,
        workoutLog,dietLog,moodLog,weightLog,habitLog,habits,
        slotDays,slotStart,lastReset,apiKeys,smokeLog,focusLog,projects};
    } catch { return null; }
  },
};



// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const PROJECT_STAGES = ["Contatto","Proposta","In corso","Revisione","Consegnato","Pagato"];
const LEAD_STAGES = ["Da contattare","Contattato","In trattativa","Perso","Convertito"];
const SECTORS = ["E-commerce","Ristorazione","Professionale","Retail","Fitness","Luxury","Altro"];
const PENALTY = [{e:"Addominali",n:20},{e:"Flessioni",n:15},{e:"Squat",n:25},{e:"Burpees",n:10},{e:"Plank",n:"60 sec"}];
const DEFAULT_FIXED = [
  {id:"f1",text:"Controlla email e rispondi ai clienti",done:false,fixed:true},
  {id:"f2",text:"Almeno 1 outreach a nuovo lead",done:false,fixed:true},
  {id:"f3",text:"Aggiorna lo stato di almeno 1 progetto",done:false,fixed:true},
];
const RANKS = [
  {r:"E",label:"Rookie Hunter",min:0,color:"#6b7280"},
  {r:"D",label:"Iron Hunter",min:100,color:"#cd7f32"},
  {r:"C",label:"Bronze Hunter",min:300,color:"#9ca3af"},
  {r:"B",label:"Silver Hunter",min:600,color:"#60a5fa"},
  {r:"A",label:"Gold Hunter",min:1000,color:"#e2b96f"},
  {r:"S",label:"Shadow Hunter",min:1500,color:"#a855f7"},
];
const MOOD_METRICS = [
  {k:"energia",label:"Energia",icons:["💀","😴","😐","⚡","🔥"]},
  {k:"umore",label:"Umore",icons:["😤","😔","😑","🙂","😄"]},
  {k:"stress",label:"Stress",icons:["🌋","😰","😬","😌","🧘"]},
  {k:"sonno",label:"Sonno",icons:["👻","😵","😪","😴","💤"]},
];
const MOOD_EMOJIS = ["😤","😔","😑","😐","🙂","😄","🤩","🔥","💪","⚡","🧘","😴","🤒","😰","🧠"];
const WORKOUT_TYPES = ["Palestra","Corsa","Ciclismo","Nuoto","Calisthenics","Sport","Altro"];
const FORFETTARIO_CAP = 85000;

// ─── SUPABASE AUTH ───────────────────────────────────────────────────────────
const sbAuth = {
  signIn: async (email, password) => {
    const sb = getSB();
    if(!sb) return {error:"Supabase non configurato"};
    try {
      const res = await fetch(`${sb.url}/auth/v1/token?grant_type=password`, {
        method:"POST",
        headers:{"apikey":sb.key,"Content-Type":"application/json","Authorization":`Bearer ${sb.key}`},
        body:JSON.stringify({email,password,gotrue_meta_security:{}})
      });
      const text = await res.text();
      let d; try { d = JSON.parse(text); } catch { return {error:"Risposta non valida dal server"}; }
      if(d.access_token) {
        localStorage.setItem("ts_auth_token", d.access_token);
        localStorage.setItem("ts_auth_refresh", d.refresh_token||"");
        localStorage.setItem("ts_auth_user", JSON.stringify(d.user));
        localStorage.setItem("ts_auth_expires", String(Date.now() + (d.expires_in||3600)*1000));
        return {user:d.user, token:d.access_token};
      }
      return {error:d.error_description||d.error||d.msg||"Credenziali non valide"};
    } catch(e) { return {error:e.message}; }
  },
  changePassword: async (newPassword) => {
    const sb = getSB();
    if(!sb) return {error:"Supabase non configurato"};
    const token = await sbAuth.getValidToken();
    if(!token) return {error:"Non sei loggato"};
    try {
      const res = await fetch(`${sb.url}/auth/v1/user`, {
        method:"PUT",
        headers:{"apikey":sb.key,"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({password:newPassword})
      });
      const d = await res.json();
      if(d.id) return {ok:true};
      return {error:d.error_description||d.msg||d.error||"Errore nel cambio password"};
    } catch(e) { return {error:e.message}; }
  },
  refresh: async () => {
    const sb = getSB();
    const refreshToken = localStorage.getItem("ts_auth_refresh");
    if(!sb||!refreshToken) return null;
    try {
      const res = await fetch(`${sb.url}/auth/v1/token?grant_type=refresh_token`, {
        method:"POST",
        headers:{"apikey":sb.key,"Content-Type":"application/json"},
        body:JSON.stringify({refresh_token:refreshToken})
      });
      const d = await res.json();
      if(d.access_token) {
        localStorage.setItem("ts_auth_token", d.access_token);
        localStorage.setItem("ts_auth_refresh", d.refresh_token||refreshToken);
        localStorage.setItem("ts_auth_expires", String(Date.now() + (d.expires_in||3600)*1000));
        return d.access_token;
      }
      return null;
    } catch { return null; }
  },
  getValidToken: async () => {
    const expires = parseInt(localStorage.getItem("ts_auth_expires")||"0");
    const token = localStorage.getItem("ts_auth_token");
    if(!token) return null;
    // Refresh if expires in less than 5 minutes
    if(Date.now() > expires - 5*60*1000) {
      const newToken = await sbAuth.refresh();
      return newToken||token;
    }
    return token;
  },
  signOut: () => {
    localStorage.removeItem("ts_auth_token");
    localStorage.removeItem("ts_auth_refresh");
    localStorage.removeItem("ts_auth_user");
    localStorage.removeItem("ts_auth_expires");
  },
  getSession: () => {
    const token = localStorage.getItem("ts_auth_token");
    const user = localStorage.getItem("ts_auth_user");
    if(!token||!user) return null;
    try { return {token, user:JSON.parse(user)}; } catch { return null; }
  },
};

// Override sbReqAuth to use JWT token
const sbReqAuth = async (path, opts={}) => {
  const sb = getSB();
  if(!sb) return null;
  const token = await sbAuth.getValidToken();
  try {
    const res = await fetch(`${sb.url}/rest/v1/${path}`, {
      headers: {
        "apikey": sb.key,
        "Authorization": token ? `Bearer ${token}` : `Bearer ${sb.key}`,
        "Content-Type":"application/json",
        "Prefer": opts.prefer||"return=representation",
        ...(opts.headers||{})
      },
      method: opts.method||"GET",
      body: opts.body,
    });
    if(!res.ok) return null;
    const t = await res.text();
    return t ? JSON.parse(t) : [];
  } catch { return null; }
};

const uid = () => Math.random().toString(36).slice(2,10);
const todayStr = () => new Date().toISOString().slice(0,10);
const getRank = xp => { let r=RANKS[0]; for(const x of RANKS){if(xp>=x.min)r=x;} return r; };
const getXP = (clients,leads,quests,tasks=[]) =>
  quests.filter(q=>q.done).length*20 +
  leads.filter(l=>l.stage==="Convertito").length*100 +
  clients.filter(c=>c.stage==="Pagato").length*50 +
  tasks.filter(t=>t.done).length*15;
const fmtEur = n => `€${Number(n||0).toLocaleString("it-IT")}`;

// ─── THEME ───────────────────────────────────────────────────────────────────
const C = {
  bg:"#03030a", panel:"#07071a", panelAlt:"#09091f",
  border:"#14142a", borderHi:"#28285a",
  accent:"#4fc3f7", accentDim:"#0b2030",
  gold:"#e2b96f", goldDim:"#251500",
  danger:"#ef4444", dangerDim:"#1a0505",
  success:"#22c55e", successDim:"#051a0a",
  purple:"#a855f7", orange:"#f97316",
  text:"#ccd6f0", textDim:"#40506a", textMuted:"#1e2a40",
};

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const GS = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:#03030a;overflow-x:hidden;}
    ::-webkit-scrollbar{width:3px;}
    ::-webkit-scrollbar-thumb{background:#28285a;border-radius:2px;}
    input,textarea,select{outline:none;}
    select option{background:#07071a;color:#ccd6f0;}
    @keyframes rpulse{0%,100%{text-shadow:0 0 10px currentColor}50%{text-shadow:0 0 30px currentColor,0 0 60px currentColor}}
    @keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
    .rp{animation:rpulse 2.5s ease-in-out infinite;}
    .fi{animation:fadein 0.22s ease forwards;}
    .blink::after{content:"▋";animation:blink 1s step-end infinite;color:#4fc3f7;}
    :root{--fs:13px;--fs-sm:11px;--fs-lg:15px;--fs-xl:17px;}
    @media(min-width:768px){:root{--fs:15px;--fs-sm:12px;--fs-lg:17px;--fs-xl:20px;}}
    @media(min-width:1100px){:root{--fs:17px;--fs-sm:14px;--fs-lg:20px;--fs-xl:24px;}}
    @media(min-width:1400px){:root{--fs:19px;--fs-sm:15px;--fs-lg:22px;--fs-xl:26px;}}
    .mono{font-family:'Share Tech Mono',monospace;font-size:var(--fs);}
    .raj{font-family:'Rajdhani',sans-serif;}
    .cin{font-family:'Cinzel',serif;}
    input,select,textarea{font-size:max(16px,var(--fs))!important;}
    .app-shell .raj, .app-shell span, .app-shell div{font-size:inherit;}
  `}</style>
);

// ─── LAYOUT PRIMITIVES ───────────────────────────────────────────────────────
const Section = ({title, action, subtitle, children}) => (
  <div style={{marginBottom:28}}>
    {(title||action) && (
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:14}}>
        <div>
          {title && <div style={{fontFamily:"'Cinzel',serif",fontSize:"clamp(15px,1.5vw,22px)",color:C.accent,letterSpacing:"0.12em",textTransform:"uppercase",lineHeight:1}}>{title}</div>}
          {subtitle && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textDim,marginTop:5,letterSpacing:"0.08em"}}>{subtitle}</div>}
        </div>
        {action && <div style={{flexShrink:0,marginLeft:12}}>{action}</div>}
      </div>
    )}
    {children}
  </div>
);

const Card = ({children, style={}, glow=false, color=null}) => (
  <div style={{
    background: C.panel,
    border: `1px solid ${glow ? (color||C.borderHi) : C.border}`,
    borderRadius: 10,
    padding: "16px 18px",
    position:"relative",
    overflow:"hidden",
    boxShadow: glow ? `0 0 24px ${(color||C.accent)}0e` : "none",
    ...style
  }}>
    {glow && <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${color||C.accent}66,transparent)`}}/>}
    {children}
  </div>
);

const Row = ({children, gap=8, style={}}) => (
  <div style={{display:"flex",gap,alignItems:"center",...style}}>{children}</div>
);

const Grid = ({cols=2, children, gap=8}) => (
  <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap}}>{children}</div>
);

const Chip = ({children, color=C.textDim, borderColor}) => (
  <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color,border:`1px solid ${borderColor||color}`,borderRadius:3,padding:"2px 8px",letterSpacing:"0.08em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{children}</span>
);

const Dot = ({color}) => (
  <div style={{width:6,height:6,borderRadius:"50%",background:color,flexShrink:0,boxShadow:`0 0 5px ${color}88`}}/>
);

// ─── FORM PRIMITIVES ─────────────────────────────────────────────────────────
const Label = ({children, color}) => (
  <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:color||C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4,fontWeight:600}}>{children}</div>
);

const Input = ({style={},...p}) => (
  <input style={{
    width:"100%",background:"#060612",border:`1px solid ${C.border}`,borderRadius:6,
    color:C.text,padding:"11px 13px",fontSize:16,fontFamily:"'Share Tech Mono',monospace",
    marginBottom:10,transition:"border-color .2s",letterSpacing:"0.02em",...style
  }} onFocus={e=>e.target.style.borderColor=C.borderHi} onBlur={e=>e.target.style.borderColor=C.border} {...p}/>
);

const Select = ({children,style={},...p}) => (
  <select style={{
    width:"100%",background:"#060612",border:`1px solid ${C.border}`,borderRadius:6,
    color:C.text,padding:"9px 12px",fontSize:15,fontFamily:"'Share Tech Mono',monospace",
    marginBottom:10,cursor:"pointer",...style
  }} {...p}>{children}</select>
);

const Textarea = ({style={},...p}) => (
  <textarea style={{
    width:"100%",background:"#060612",border:`1px solid ${C.border}`,borderRadius:6,
    color:C.text,padding:"9px 12px",fontSize:15,fontFamily:"'Share Tech Mono',monospace",
    resize:"vertical",marginBottom:10,lineHeight:1.65,...style
  }} onFocus={e=>e.target.style.borderColor=C.borderHi} onBlur={e=>e.target.style.borderColor=C.border} {...p}/>
);

// ─── BUTTONS ─────────────────────────────────────────────────────────────────
const Btn = ({children, variant="primary", style={}, size="md", ...p}) => {
  const sizes = {sm:"6px 10px",md:"9px 16px",lg:"12px 20px"};
  const variants = {
    primary:{bg:`linear-gradient(135deg,${C.accentDim},#050f18)`,border:C.accent,color:C.accent},
    gold:{bg:`linear-gradient(135deg,${C.goldDim},#0a0700)`,border:C.gold,color:C.gold},
    danger:{bg:"transparent",border:C.border,color:C.textDim},
    ghost:{bg:"transparent",border:C.border,color:C.textDim},
    success:{bg:C.successDim,border:C.success,color:C.success},
  };
  const v = variants[variant]||variants.primary;
  return (
    <button style={{
      background:v.bg,border:`1px solid ${v.border}`,borderRadius:5,color:v.color,
      padding:sizes[size]||sizes.md,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",
      fontWeight:700,fontSize:size==="sm"?10:12,letterSpacing:"0.1em",textTransform:"uppercase",
      transition:"all .2s",display:"inline-flex",alignItems:"center",gap:5,...style
    }}
    onMouseEnter={e=>{if(variant==="primary")e.currentTarget.style.boxShadow=`0 0 14px ${C.accent}44`;if(variant==="danger"){e.currentTarget.style.borderColor=C.danger;e.currentTarget.style.color=C.danger;}}}
    onMouseLeave={e=>{e.currentTarget.style.boxShadow="";if(variant==="danger"){e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.textDim;}}}
    {...p}>{children}</button>
  );
};

// ─── MODAL ────────────────────────────────────────────────────────────────────
const Modal = ({title, subtitle, onClose, children}) => (
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",backdropFilter:"blur(10px)",zIndex:300,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"10px"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:C.panel,border:`1px solid ${C.borderHi}`,borderRadius:10,width:"100%",maxWidth:520,maxHeight:"calc(100dvh - 20px)",display:"flex",flexDirection:"column",boxShadow:`0 0 40px ${C.accent}10`}} onClick={e=>e.stopPropagation()}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:15,color:C.accent,letterSpacing:"0.15em",textTransform:"uppercase"}}>{title}</div>
        <button onClick={onClose} style={{background:"none",border:"none",color:C.textDim,cursor:"pointer",fontSize:20,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
      </div>
      <div style={{overflowY:"auto",overflowX:"hidden",padding:"14px 16px 20px",flex:"1 1 auto",minHeight:0}}>{children}</div>
    </div>
  </div>
);

// ─── STAT BOX ─────────────────────────────────────────────────────────────────
const StatBox = ({label, value, sub, color=C.accent, style={}}) => (
  <Card style={style}>
    <Label>{label}</Label>
    <div style={{fontFamily:"'Cinzel',serif",fontSize:"clamp(26px,2.5vw,38px)",fontWeight:700,color,lineHeight:1,marginBottom:sub?4:0}}>{value}</div>
    {sub && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textMuted}}>{sub}</div>}
  </Card>
);

// ─── PROGRESS BAR ─────────────────────────────────────────────────────────────
const ProgressBar = ({pct, color=C.accent, height=5, style={}}) => (
  <div style={{background:C.bg,borderRadius:3,height,border:`1px solid ${C.border}`,overflow:"hidden",...style}}>
    <div style={{width:`${Math.min(pct,100)}%`,height:"100%",background:`linear-gradient(90deg,${color},${color}cc)`,borderRadius:3,transition:"width .6s ease",boxShadow:pct>0?`0 0 6px ${color}66`:"none"}}/>
  </div>
);

// ─── XP BAR ──────────────────────────────────────────────────────────────────
const XPBar = ({xp}) => {
  const rank = getRank(xp);
  const next = RANKS[RANKS.indexOf(rank)+1];
  const pct = next ? Math.round((xp-rank.min)/(next.min-rank.min)*100) : 100;
  return (
    <Card glow style={{marginBottom:16}}>
      <Row style={{justifyContent:"space-between",marginBottom:10}}>
        <div>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:22,fontWeight:900,color:rank.color,lineHeight:1}} className="rp">{rank.r}-Rank</div>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:"clamp(9px,0.9vw,13px)",color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginTop:3}}>{rank.label}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.accent}}>{xp} <span style={{fontSize:15,color:C.textDim}}>XP</span></div>
          {next && <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.textDim,marginTop:2}}>→ {next.r}: {next.min} XP</div>}
        </div>
      </Row>
      <ProgressBar pct={pct} color={rank.color}/>
      <Row style={{justifyContent:"space-between",marginTop:4}}>
        <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted}}>{rank.min}</span>
        <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textDim}}>{pct}%</span>
        {next && <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted}}>{next.min}</span>}
      </Row>
    </Card>
  );
};

// ─── PENALTY MODAL ───────────────────────────────────────────────────────────
const PenaltyModal = ({quest, failedQuests=[], anthropicKey, onClose}) => {
  const [penalty, setPenalty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);

  useEffect(()=>{
    const gen = async () => {
      if(!anthropicKey) {
        // Fallback: random penalty
        const p = PENALTY[Math.floor(Math.random()*PENALTY.length)];
        setPenalty({exercise:p.e, reps:p.n, reason:"Esegui ora. Nessuna eccezione."});
        setLoading(false);
        return;
      }
      try {
        const allFailed = failedQuests.length > 0 ? failedQuests : [quest];
        const res = await fetch("https://apify-worker.luciettiandrea.workers.dev/anthropic/v1/messages",{
          method:"POST",
          headers:{"Content-Type":"application/json","x-api-key":anthropicKey},
          body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:150,messages:[{role:"user",content:`Sei il sistema di penalità di The System (stile Solo Leveling). Andrea ha fallito ${allFailed.length} quest: "${allFailed.map(q=>q.text).join('", "')}". Assegna UNA penalità fisica proporzionale. Rispondi SOLO con JSON: {"exercise":"nome esercizio","reps":numero,"reason":"frase motivazionale corta e dura"}`}]})
        });
        const d = await res.json();
        const p = JSON.parse((d.content?.[0]?.text||"{}").replace(/\`\`\`json|\`\`\`/g,"").trim());
        setPenalty(p);
      } catch {
        const p = PENALTY[Math.floor(Math.random()*PENALTY.length)];
        setPenalty({exercise:p.e, reps:p.n, reason:"Esegui ora. Nessuna eccezione."});
      }
      setLoading(false);
    };
    gen();
  },[]);

  return (
    <Modal title="⚡ QUEST FAILED — PENALTY" onClose={onClose}>
      <div style={{textAlign:"center",padding:"8px 0 4px"}}>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:24,color:C.danger,textShadow:`0 0 20px ${C.danger}`,marginBottom:12}}>PENALITÀ ASSEGNATA</div>
        <Card style={{marginBottom:12,textAlign:"left"}}>
          {failedQuests.length>1
            ? <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.textDim}}>{failedQuests.length} quest fallite</div>
            : <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.text}}>"{quest.text}"</div>
          }
        </Card>
        {loading ? (
          <Card glow style={{marginBottom:16,padding:"24px 16px"}}>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.accent}}>Il Sistema sta calcolando la tua punizione...</div>
          </Card>
        ) : penalty && (
          <Card glow color={C.danger} style={{marginBottom:16,padding:"20px 16px",borderColor:C.danger+"66"}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:52,fontWeight:900,color:C.danger,lineHeight:1,textShadow:`0 0 30px ${C.danger}`}}>{penalty.reps}</div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:20,color:C.text,fontWeight:700,marginTop:6,letterSpacing:"0.08em",textTransform:"uppercase"}}>{penalty.exercise}</div>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.textDim,marginTop:10,fontStyle:"italic"}}>"{penalty.reason}"</div>
          </Card>
        )}
        {!loading && !done
          ? <Btn style={{width:"100%",justifyContent:"center",padding:"13px",borderColor:C.danger,color:C.danger,background:`${C.danger}15`}} onClick={()=>setDone(true)}>[ PENALITÀ COMPLETATA ]</Btn>
          : !loading && <>
              <div style={{fontFamily:"'Cinzel',serif",color:C.success,marginBottom:12,fontSize:13,letterSpacing:"0.1em"}}>BENE. NON DIMENTICARLO.</div>
              <Btn style={{width:"100%",justifyContent:"center"}} onClick={onClose}>[ CHIUDI ]</Btn>
            </>
        }
      </div>
    </Modal>
  );
};

// ─── INVOICE CALCULATOR ──────────────────────────────────────────────────────
const InvoiceCalc = () => {
  const [want, setWant] = useState("");
  const [net, setNet] = useState("");

  const wantResult = want ? Math.round(parseFloat(want) * 1.43) : null;
  const netResult = net ? Math.round(parseFloat(net) * 0.70) : null;

  return (
    <Grid cols={2} gap={10}>
      {/* Voglio guadagnare X */}
      <Card style={{borderColor:C.gold+"44"}}>
        <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:11,color:C.gold,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10,fontWeight:700}}>Voglio guadagnare</div>
        <Label>Importo netto desiderato (€)</Label>
        <Input
          type="number"
          value={want}
          onChange={e=>setWant(e.target.value)}
          placeholder="Es. 1000"
          style={{marginBottom:8}}
        />
        {wantResult && (
          <div style={{background:`${C.gold}11`,border:`1px solid ${C.gold}44`,borderRadius:6,padding:"10px 12px"}}>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.textDim,marginBottom:4}}>Fattura da emettere</div>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:26,fontWeight:900,color:C.gold,lineHeight:1}}>{fmtEur(wantResult)}</div>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textDim,marginTop:4}}>{fmtEur(want)} + 43% = {fmtEur(wantResult)}</div>
          </div>
        )}
      </Card>

      {/* Guadagno netto */}
      <Card style={{borderColor:C.success+"44"}}>
        <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:11,color:C.success,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10,fontWeight:700}}>Guadagno netto</div>
        <Label>Importo fattura (€)</Label>
        <Input
          type="number"
          value={net}
          onChange={e=>setNet(e.target.value)}
          placeholder="Es. 1000"
          style={{marginBottom:8}}
        />
        {netResult && (
          <div style={{background:`${C.success}0a`,border:`1px solid ${C.success}44`,borderRadius:6,padding:"10px 12px"}}>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.textDim,marginBottom:4}}>Netto in tasca</div>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:26,fontWeight:900,color:C.success,lineHeight:1}}>{fmtEur(netResult)}</div>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textDim,marginTop:4}}>{fmtEur(net)} - 30% = {fmtEur(netResult)}</div>
          </div>
        )}
      </Card>
    </Grid>
  );
};

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
const Dashboard = ({clients,leads,quests,tasks,workoutLog,dietLog,moodLog,goals,payments,onWeeklyReview,anthropicKey,smokeLog={},setSmokeLog}) => {
  const [penaltyFromAlert, setPenaltyFromAlert] = useState(false);
  const xp = getXP(clients,leads,quests,tasks);
  const today = todayStr();
  const active = clients.filter(c=>!["Consegnato","Pagato"].includes(c.stage)).length;
  const hot = leads.filter(l=>l.stage==="In trattativa").length;
  const questDone = quests.filter(q=>q.done).length;
  const questPct = quests.length ? Math.round(questDone/quests.length*100) : 0;

  const yearPayments = payments.filter(p=>p.date?.startsWith(new Date().getFullYear().toString()));
  const yearTotal = yearPayments.reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  const pendingClients = clients.filter(c=>!["Pagato"].includes(c.stage)&&c.income);
  const pendingTotal = pendingClients.reduce((s,c)=>s+(parseFloat(c.income)||0),0);

  const todayMood = moodLog[today];
  const todayWorkout = workoutLog[today];
  const todayDiet = dietLog[today];
  const moodAvg = todayMood?.scores ? (Object.values(todayMood.scores).reduce((a,b)=>a+b,0)/Object.values(todayMood.scores).length).toFixed(1) : null;
  const [todayCigs, setTodayCigs] = useState(()=>smokeLog[today]||0);
  useEffect(()=>setTodayCigs(smokeLog[today]||0),[smokeLog,today]);

  return (
    <div className="fi">
      <XPBar xp={xp}/>

      <Row style={{justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textMuted,letterSpacing:"0.1em"}}>
          // {new Date().toLocaleDateString("it-IT",{weekday:"long",day:"numeric",month:"long","year":"numeric"}).toUpperCase()}
        </div>
        {onWeeklyReview && <button onClick={onWeeklyReview} style={{background:C.accentDim,border:`1px solid ${C.accent}`,borderRadius:5,color:C.accent,cursor:"pointer",padding:"6px 14px",fontFamily:"'Rajdhani',sans-serif",fontSize:14,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>📊 Week Review</button>}
      </Row>

      {/* Business */}
      <Section title="Business">
        <Grid cols={3} gap={8} style={{marginBottom:7}}>
          <StatBox label="Clienti" value={active} sub="progetti attivi"/>
          <StatBox label="Lead" value={hot} color={C.gold} sub="in trattativa"/>
          <StatBox label="Quest" value={`${questDone}/${quests.length}`} color={questPct===100?C.success:questPct>50?C.gold:C.danger} sub={`${questPct}% done`}/>
        </Grid>
        <Card>
          <Row style={{justifyContent:"space-between",alignItems:"flex-end"}}>
            <div>
              <Label>Incassato {new Date().getFullYear()}</Label>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:22,color:C.gold,lineHeight:1}}>{fmtEur(yearTotal)}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <Label>Da incassare</Label>
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:pendingTotal>0?C.orange:C.textDim}}>{fmtEur(pendingTotal)}</div>
            </div>
          </Row>
        </Card>
      </Section>

      {/* Oggi */}
      <Section title="Oggi">
        <Grid cols={3} gap={8} style={{marginBottom:7}}>
          <Card style={{textAlign:"center",padding:"12px 8px"}}>
            <div style={{fontSize:22,marginBottom:5}}>{todayWorkout?.done?"💪":"🛋️"}</div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:todayWorkout?.done?C.success:C.textDim,letterSpacing:"0.1em",textTransform:"uppercase"}}>{todayWorkout?.done?"Allenato":"No WO"}</div>
            {todayWorkout?.type && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,marginTop:2}}>{todayWorkout.type}</div>}
          </Card>
          <Card style={{textAlign:"center",padding:"12px 8px"}}>
            <div style={{fontSize:22,marginBottom:5}}>{todayDiet?.ok===true?"✅":todayDiet?.ok===false?"🍕":"🍽️"}</div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:todayDiet?.ok===true?C.success:todayDiet?.ok===false?C.danger:C.textDim,letterSpacing:"0.1em",textTransform:"uppercase"}}>
              {todayDiet?.ok===true?"Dieta ok":todayDiet?.ok===false?"Sgarro":"No log"}
            </div>
          </Card>
          <Card style={{textAlign:"center",padding:"12px 8px"}}>
            <div style={{fontSize:22,marginBottom:5}}>{todayMood?.emoji||"❓"}</div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:moodAvg>=4?C.success:moodAvg>=3?C.gold:moodAvg?C.danger:C.textDim,letterSpacing:"0.1em",textTransform:"uppercase"}}>
              {moodAvg?`${moodAvg}`:"Check-in"}
            </div>
          </Card>
        </Grid>
      </Section>

      {/* Sigarette */}
      <Section title="🚬 Sigarette oggi">
        <Card glow color={todayCigs>15?C.danger:todayCigs>8?C.orange:C.gold}>
          <Row style={{alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:64,fontWeight:900,color:todayCigs>15?C.danger:todayCigs>8?C.orange:C.gold,lineHeight:1}}>{todayCigs}</div>
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:14,color:C.textDim,marginTop:4}}>
                {todayCigs===0?"zero oggi, ottimo":todayCigs<=5?"nella norma":todayCigs<=10?"attenzione":"troppo"}
              </div>
            </div>
            <Row gap={12}>
              <button onClick={()=>{const v=Math.max(0,todayCigs-1);setSmokeLog&&setSmokeLog(s=>({...s,[today]:v}));setTodayCigs(v);}} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,cursor:"pointer",width:52,height:52,fontSize:26,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
              <button onClick={()=>{const v=todayCigs+1;setSmokeLog&&setSmokeLog(s=>({...s,[today]:v}));setTodayCigs(v);}} style={{background:C.accentDim,border:`1px solid ${todayCigs>15?C.danger:todayCigs>8?C.orange:C.gold}`,borderRadius:8,color:todayCigs>15?C.danger:todayCigs>8?C.orange:C.gold,cursor:"pointer",width:52,height:52,fontSize:26,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
            </Row>
          </Row>
        </Card>
      </Section>

      {/* Invoice Calculator */}
      <Section title="Calcolo Fattura">
        <InvoiceCalc/>
      </Section>

      {/* Goals preview */}
      {goals.filter(g=>!g.done).length > 0 && (
        <Section title="Goals attivi">
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {goals.filter(g=>!g.done).slice(0,3).map(g=>{
              const gStart = g.start!==undefined ? g.start : 0;
            const descending = gStart > g.target;
            let pct;
            if(descending){
              const total = gStart - g.target;
              pct = total>0 ? Math.min(Math.round((gStart-(g.current||0))/total*100),100) : 0;
            } else {
              pct = Math.min(Math.round((g.current||0)/(g.target||1)*100),100);
            }
            pct = Math.max(0,pct);
              return (
                <Card key={g.id}>
                  <Row style={{justifyContent:"space-between",marginBottom:7}}>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.text,fontWeight:600}}>{g.title}</div>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.accent}}>{pct}%</div>
                  </Row>
                  <ProgressBar pct={pct} color={C.purple}/>
                  {g.target && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textMuted,marginTop:5}}>{g.current||0} / {g.target} {g.unit||""}</div>}
                </Card>
              );
            })}
          </div>
        </Section>
      )}

      {/* Tasks preview in home */}
      {tasks.filter(t=>!t.done).length > 0 && (
        <Section title="Task da fare">
          <Card>
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {tasks.filter(t=>!t.done).slice(0,5).map(t=>(
                <Row key={t.id} gap={10}>
                  <Dot color={C.purple}/>
                  <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.text,flex:1,lineHeight:1.4}}>{t.text}</span>
                  {t.xp && <Chip color={C.purple}>+{t.xp}xp</Chip>}
                </Row>
              ))}
              {tasks.filter(t=>!t.done).length>5 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textMuted}}>+{tasks.filter(t=>!t.done).length-5} altri</div>}
            </div>
          </Card>
        </Section>
      )}

      {/* Alert banners */}
      {(() => {
        const alerts = [];
        const now2 = new Date();
        const ym = `${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,"0")}`;
        // Overdue payments
        const overdueLeads = leads.filter(l=>l.stage==="In trattativa").length;
        if(overdueLeads>0) alerts.push({color:C.gold,icon:"💰",msg:`${overdueLeads} lead in trattativa — hai seguito up?`});
        // Quest not done end of day
        const questLeft = quests.filter(q=>!q.done).length;
        if(questLeft>0 && now2.getHours()>=18) alerts.push({color:C.danger,icon:"⚡",msg:`${questLeft} quest non completate — pena in arrivo`,action:"penalty"});
        // Tasks old >7 days
        const oldTasks = tasks.filter(t=>!t.done&&t.createdAt&&((new Date()-new Date(t.createdAt))/(1000*60*60*24))>7).length;
        if(oldTasks>0) alerts.push({color:C.orange,icon:"📌",msg:`${oldTasks} task aperto da più di 7 giorni`});
        if(alerts.length===0) return null;
        return (
          <div style={{marginBottom:16,display:"flex",flexDirection:"column",gap:6}}>
            {alerts.map((a,i)=>(
              <div key={i} style={{background:`${a.color}11`,border:`1px solid ${a.color}44`,borderRadius:7,padding:"9px 13px",display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:16,flexShrink:0}}>{a.icon}</span>
                <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:a.color,fontWeight:600}}>{a.msg}</span>
              </div>
            ))}
          </div>
        );
      })()}
      {/* Quest log */}
      <Section title="Quest Log">
        <Card>
          {quests.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted}}>// no quests assigned</div>}
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {quests.filter(q=>!q.done).map(q=>(
              <Row key={q.id} gap={10}>
                <Dot color={C.borderHi}/>
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.text,flex:1,lineHeight:1.4}}>{q.text}</span>
                {q.fixed && <Chip color={C.textMuted}>fixed</Chip>}
              </Row>
            ))}
            {quests.filter(q=>!q.done).length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.success,textAlign:"center",padding:"8px 0"}}>✓ tutte le quest completate</div>}
          </div>
        </Card>
      </Section>
      {penaltyFromAlert && (
        <PenaltyModal quest={quests.filter(q=>!q.done)[0]||{text:"quest non completate"}} failedQuests={quests.filter(q=>!q.done)} anthropicKey={anthropicKey} onClose={()=>setPenaltyFromAlert(false)}/>
      )}
    </div>
  );
};


// ─── QUESTS ──────────────────────────────────────────────────────────────────
const QuestsView = ({quests, setQuests, moodLog, anthropicKey, onNeedKey}) => {
  const [newText, setNewText] = useState("");
  const [penalty, setPenalty] = useState(null);
  const [editFixed, setEditFixed] = useState(false);
  const [fixedDraft, setFixedDraft] = useState("");
  const [showAI, setShowAI] = useState(false);
  const [resoconto, setResoconto] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const fixed = quests.filter(q=>q.fixed);
  const variable = quests.filter(q=>!q.fixed);
  const done = quests.filter(q=>q.done).length;
  const pct = quests.length ? Math.round(done/quests.length*100) : 0;
  const toggle = async id => {
    const q = quests.find(x=>x.id===id);
    if(!q) return;
    const updatedQ = {...q, done:!q.done};
    setQuests(prev=>prev.map(x=>x.id===id?updatedQ:x));
    await pushItem("quests", updatedQ);
  };
  const addV = () => { if(!newText.trim())return; const nq={id:uid(),text:newText.trim(),done:false,fixed:false}; setQuests(prev=>[...prev,nq]); pushItem("quests",nq); setNewText(""); };
  const addF = () => { if(!fixedDraft.trim())return; const nq={id:uid(),text:fixedDraft.trim(),done:false,fixed:true}; setQuests(prev=>[...prev,nq]); pushItem("quests",nq); setFixedDraft(""); };

  const today = todayStr();
  const todayMood = moodLog[today];

  const askAI = async () => {
    if(!anthropicKey){onNeedKey();return;}
    setAiLoading(true); setAiSuggestions(null);
    try {
      const moodNote = todayMood?.note||"";
      const moodAvg = todayMood?.scores ? (Object.values(todayMood.scores).reduce((a,b)=>a+b,0)/Object.values(todayMood.scores).length).toFixed(1) : null;
      const prompt = `Sei The System, l'AI di Andrea (freelance web design, Vicenza, Studio Brillo).
Quest attuali:
FISSE: ${fixed.map(q=>q.text).join(" | ")||"nessuna"}
VARIABILI: ${variable.map(q=>q.text).join(" | ")||"nessuna"}
Umore oggi: ${todayMood?.emoji||"N/D"} media ${moodAvg||"N/D"}/5
Nota umore: "${moodNote||"nessuna"}"
Resoconto: "${resoconto||"nessuno"}"

Analizza e suggerisci modifiche CONCRETE. Rispondi SOLO con JSON:
{"analisi":"2-3 frasi su come sta andando","rimuovi":["testo esatto quest da togliere"],"aggiungi_fisse":["nuove quest fisse"],"aggiungi_variabili":["nuove quest per oggi"],"modifica":[{"da":"testo originale","a":"testo nuovo"}]}`;
      const res = await fetch("https://apify-worker.luciettiandrea.workers.dev/anthropic/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":anthropicKey},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:600,messages:[{role:"user",content:prompt}]})});
      const d = await res.json();
      const parsed = JSON.parse((d.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim());
      setAiSuggestions(parsed);
    } catch { setAiSuggestions({analisi:"Errore nell'analisi. Riprova.",rimuovi:[],aggiungi_fisse:[],aggiungi_variabili:[],modifica:[]}); }
    finally { setAiLoading(false); }
  };

  const applyAI = () => {
    if(!aiSuggestions) return;
    let updated = [...quests];
    if(aiSuggestions.rimuovi?.length) updated = updated.filter(q=>!aiSuggestions.rimuovi.includes(q.text));
    if(aiSuggestions.modifica?.length) updated = updated.map(q=>{const m=aiSuggestions.modifica.find(x=>x.da===q.text);return m?{...q,text:m.a}:q;});
    if(aiSuggestions.aggiungi_fisse?.length) updated = [...updated,...aiSuggestions.aggiungi_fisse.map(t=>({id:uid(),text:t,done:false,fixed:true}))];
    if(aiSuggestions.aggiungi_variabili?.length) updated = [...updated,...aiSuggestions.aggiungi_variabili.map(t=>({id:uid(),text:t,done:false,fixed:false}))];
    setQuests(updated); setAiSuggestions(null); setShowAI(false); setResoconto("");
  };

  const QRow = ({q, canDel}) => (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:C.bg,border:`1px solid ${q.done?C.success+"55":C.border}`,borderRadius:6,transition:"border-color .2s"}}>
      <button onClick={()=>toggle(q.id)} style={{width:17,height:17,borderRadius:3,border:`1px solid ${q.done?C.success:C.borderHi}`,background:q.done?C.success:"transparent",cursor:"pointer",flexShrink:0,fontSize:16,color:C.bg,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}}>
        {q.done&&"✓"}
      </button>
      <span style={{flex:1,fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:q.done?C.textDim:C.text,textDecoration:q.done?"line-through":"none",lineHeight:1.4}}>{q.text}</span>
      {!q.done && <button onClick={()=>setPenalty(q)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:3,color:C.danger,cursor:"pointer",fontSize:15,fontFamily:"'Rajdhani',sans-serif",padding:"2px 6px",opacity:.8}}>FAIL</button>}
      {canDel && <button onClick={()=>{setQuests(prev=>prev.filter(x=>x.id!==q.id));deleteItem('quests',q.id);}} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:15,lineHeight:1,padding:"0 2px"}}>×</button>}
    </div>
  );

  return (
    <div className="fi">
      <Section title="Daily Quests" action={
        <Row gap={6}>
          {pct===100 && <Chip color={C.success} borderColor={C.success}>ALL CLEAR ✦</Chip>}
          <Btn size="sm" variant="ghost" onClick={async()=>{const d=await DB.pullAll();if(d?.quests){const today=todayStr();setQuests(d.quests.filter(q=>!q.done||q.fixed));} }} style={{fontSize:13}}>🔄</Btn>
          <Btn size="sm" variant="gold" onClick={()=>setShowAI(!showAI)}>⚡ AI Quest</Btn>
        </Row>
      }>
        <Card glow style={{marginBottom:16}}>
          <Row style={{justifyContent:"space-between",marginBottom:8}}>
            <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:"clamp(9px,0.9vw,13px)",color:C.textDim,letterSpacing:"0.15em",textTransform:"uppercase"}}>Progress</span>
            <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:pct===100?C.success:pct>50?C.gold:C.danger}}>{done}/{quests.length} — {pct}%</span>
          </Row>
          <ProgressBar pct={pct} color={pct===100?C.success:pct>50?C.gold:C.danger} height={6}/>
        </Card>

        {showAI && (
          <Card style={{marginBottom:16,borderColor:C.gold+"55",background:`${C.goldDim}88`}}>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:C.gold,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:10}}>⚡ The System — Analisi Quest</div>
            {todayMood && (
              <div style={{background:C.bg,borderRadius:4,padding:"6px 10px",marginBottom:10,fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textDim}}>
                Umore letto: {todayMood.emoji||"—"} {todayMood.note?`"${todayMood.note.slice(0,50)}..."`:""} 
              </div>
            )}
            <Label>Resoconto libero (opzionale)</Label>
            <Textarea value={resoconto} onChange={e=>setResoconto(e.target.value)} placeholder="Com'è andata? Hai procrastinato? Cosa ti ha bloccato? Sei stato in forma? Scrivi quello che vuoi..." style={{minHeight:70,marginBottom:10}}/>
            <Btn variant="gold" style={{width:"100%",justifyContent:"center",opacity:aiLoading?.6:1}} onClick={askAI} disabled={aiLoading}>
              {aiLoading?"[ Analisi in corso... ]":"[ ANALIZZA E SUGGERISCI ]"}
            </Btn>
            {aiSuggestions && (
              <div style={{marginTop:14}}>
                <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,padding:12,marginBottom:12}}>
                  <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:C.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Analisi</div>
                  <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.text,lineHeight:1.6}}>{aiSuggestions.analisi}</div>
                </div>
                {aiSuggestions.rimuovi?.length>0 && (
                  <div style={{marginBottom:7}}>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.danger,letterSpacing:"0.1em",marginBottom:5}}>— DA RIMUOVERE</div>
                    {aiSuggestions.rimuovi.map((t,i)=><div key={i} style={{fontFamily:"'Share Tech Mono',monospace",fontSize:"clamp(9px,0.9vw,13px)",color:C.textDim,padding:"4px 8px",background:C.dangerDim,borderRadius:3,marginBottom:3}}>{t}</div>)}
                  </div>
                )}
                {aiSuggestions.modifica?.length>0 && (
                  <div style={{marginBottom:7}}>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.orange,letterSpacing:"0.1em",marginBottom:5}}>~ DA MODIFICARE</div>
                    {aiSuggestions.modifica.map((m,i)=><div key={i} style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textDim,padding:"4px 8px",background:C.bg,border:`1px solid ${C.border}`,borderRadius:3,marginBottom:3}}>"{m.da}" → "{m.a}"</div>)}
                  </div>
                )}
                {(aiSuggestions.aggiungi_fisse?.length>0||aiSuggestions.aggiungi_variabili?.length>0) && (
                  <div style={{marginBottom:12}}>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.success,letterSpacing:"0.1em",marginBottom:5}}>+ DA AGGIUNGERE</div>
                    {[...(aiSuggestions.aggiungi_fisse||[]).map(t=>({t,f:true})),...(aiSuggestions.aggiungi_variabili||[]).map(t=>({t,f:false}))].map(({t,f},i)=>(
                      <div key={i} style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.text,padding:"4px 8px",background:C.successDim,borderRadius:3,marginBottom:3}}>
                        {t} <span style={{color:C.textMuted,fontSize:7}}>{f?"[fixed]":"[oggi]"}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Row gap={8}>
                  <Btn variant="ghost" size="sm" style={{flex:1,justifyContent:"center"}} onClick={()=>setAiSuggestions(null)}>Annulla</Btn>
                  <Btn variant="gold" size="sm" style={{flex:2,justifyContent:"center"}} onClick={applyAI}>[ APPLICA ]</Btn>
                </Row>
              </div>
            )}
          </Card>
        )}

        <div style={{marginBottom:20}}>
          <Row style={{justifyContent:"space-between",marginBottom:10}}>
            <Label>🔒 Fixed</Label>
            <Btn variant="ghost" size="sm" onClick={()=>setEditFixed(!editFixed)}>{editFixed?"DONE":"MANAGE"}</Btn>
          </Row>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {fixed.map(q=><QRow key={q.id} q={q} canDel={editFixed}/>)}
          </div>
          {editFixed && (
            <Row gap={6} style={{marginTop:8}}>
              <Input style={{marginBottom:0,flex:1,fontSize:11}} value={fixedDraft} onChange={e=>setFixedDraft(e.target.value)} placeholder="New fixed quest..." onKeyDown={e=>e.key==="Enter"&&addF()}/>
              <Btn size="sm" onClick={addF}>+</Btn>
            </Row>
          )}
        </div>
        <div>
          <Label style={{marginBottom:10}}>📌 Variable</Label>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {variable.map(q=><QRow key={q.id} q={q} canDel={true}/>)}
          </div>
          <Row gap={6} style={{marginTop:8}}>
            <Input style={{marginBottom:0,flex:1,fontSize:11}} value={newText} onChange={e=>setNewText(e.target.value)} placeholder="Add today's quest..." onKeyDown={e=>e.key==="Enter"&&addV()}/>
            <Btn size="sm" onClick={addV}>+</Btn>
          </Row>
        </div>
      </Section>
      {penalty && <PenaltyModal quest={penalty} failedQuests={quests.filter(q=>!q.done)} anthropicKey={anthropicKey} onClose={()=>setPenalty(null)}/>}
    </div>
  );
};

// ─── CLIENTS ─────────────────────────────────────────────────────────────────
// Client schema:
// { id, name, contact, sector, stage, type: "ricorrente"|"spot",
//   monthlyFee (se ricorrente),
//   installments: [{id, amount, dueDate, label}] (se spot),
//   notes, createdAt }

const EMPTY_FORM = {name:"",contact:"",sector:"Altro",stage:"In corso",type:"ricorrente",monthlyFee:"",installments:[],notes:""};

const ClientsView = ({clients, setClients}) => {
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [instForm, setInstForm] = useState({amount:"",dueDate:"",label:""});

  const [search, setSearch] = useState("");
  const [logClient, setLogClient] = useState(null);
  const [logText, setLogText] = useState("");
  const addLog = () => { if(!logText.trim()||!logClient) return; setClients(clients.map(c=>c.id===logClient.id?{...c,activityLog:[...(c.activityLog||[]),{id:uid(),date:todayStr(),text:logText.trim()}]}:c)); setLogText(""); setLogClient(null); };
  const open = c => {
    setEditing(c?c.id:null);
    setForm(c ? {
      name:c.name||"", contact:c.contact||"", sector:c.sector||"Altro",
      stage:c.stage||"In corso", type:c.type||"ricorrente",
      monthlyFee:c.monthlyFee||"", installments:c.installments||[], notes:c.notes||""
    } : EMPTY_FORM);
    setModal(true);
  };

  const saveC = () => {
    if(!form.name.trim()) return;
    const client = {
      ...form,
      installments: form.installments||[],
      monthlyFee: form.monthlyFee||"",
    };
    let savedClient;
    if(editing){ savedClient={...clients.find(c=>c.id===editing),...client}; setClients(prev=>prev.map(c=>c.id===editing?savedClient:c)); }
    else{ savedClient={id:uid(),...client,created_at:todayStr()}; setClients(prev=>[...prev,savedClient]); }
    pushItem("clients", savedClient);
    setModal(false);
  };

  const addInst = () => {
    if(!instForm.amount||!instForm.dueDate) return;
    setForm({...form, installments:[...form.installments,{id:uid(),...instForm}]});
    setInstForm({amount:"",dueDate:"",label:""});
  };

  const typeColor = {ricorrente:C.accent, spot:C.gold};
  const sc = {"Contatto":C.textDim,"Proposta":C.gold,"In corso":C.accent,"Revisione":C.purple,"Consegnato":C.success,"Pagato":C.success};

  return (
    <div className="fi">
      <Section title="Clienti" action={<Btn size="sm" onClick={()=>open(null)}>+ Nuovo</Btn>}>
        {clients.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,padding:"24px 0",textAlign:"center"}}>// Nessun cliente ancora.</div>}
        {/* Search */}
        <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cerca cliente..." style={{marginBottom:10}}/>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {clients.filter(c=>!search||c.name.toLowerCase().includes(search.toLowerCase())||c.contact?.toLowerCase().includes(search.toLowerCase())).map(c=>(
            <Card key={c.id}>
              <Row style={{alignItems:"flex-start",justifyContent:"space-between"}}>
                <div style={{flex:1,minWidth:0}}>
                  <Row gap={8} style={{marginBottom:5,flexWrap:"wrap"}}>
                    <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,color:C.text,fontSize:14}}>{c.name}</span>
                    <Chip color={typeColor[c.type]||C.textDim} borderColor={typeColor[c.type]||C.border}>{c.type||"spot"}</Chip>
                    <Chip color={sc[c.stage]||C.textDim} borderColor={sc[c.stage]||C.border}>{c.stage}</Chip>
                  </Row>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:"clamp(9px,0.9vw,13px)",color:C.textDim,marginBottom:4}}>{c.contact} · {c.sector}</div>
                  {(c.monthly_fee||c.monthlyFee) && parseFloat(c.monthly_fee||c.monthlyFee)>0 && (
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.accent}}>{fmtEur(c.monthly_fee||c.monthlyFee)}<span style={{fontSize:15,color:C.textDim}}>/mese</span></div>
                  )}
                  {c.installments?.length>0 && (
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.gold}}>{c.installments.length} rata{c.installments.length>1?"e":""} — tot. {fmtEur(c.installments.reduce((s,i)=>s+(parseFloat(i.amount)||0),0))}</div>
                  )}
                  {c.notes && <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:C.textMuted,marginTop:3,fontStyle:"italic"}}>{c.notes}</div>}
                  {/* Activity log preview */}
                  {(c.activityLog||[]).length>0 && (
                    <div style={{marginTop:6,borderTop:`1px solid ${C.border}`,paddingTop:6}}>
                      <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,marginBottom:3}}>Ultimo contatto: {(c.activityLog||[]).slice(-1)[0]?.date} — {(c.activityLog||[]).slice(-1)[0]?.text}</div>
                    </div>
                  )}
                </div>
                <Row gap={5} style={{flexShrink:0}}>
                  <button onClick={()=>setLogClient(c)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:4,color:C.textDim,cursor:"pointer",padding:"3px 7px",fontSize:15,fontFamily:"'Rajdhani',sans-serif"}}>Log</button>
                  <Btn variant="ghost" size="sm" onClick={()=>open(c)}>Edit</Btn>
                  <Btn variant="danger" size="sm" onClick={()=>{setClients(prev=>prev.filter(x=>x.id!==c.id));deleteItem('clients',c.id);}}>Del</Btn>
                </Row>
              </Row>
            </Card>
          ))}
        </div>
      </Section>

      {logClient && (
        <Modal title={`Log attività — ${logClient.name}`} onClose={()=>setLogClient(null)}>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12,maxHeight:180,overflowY:"auto"}}>
            {(logClient.activityLog||[]).length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted}}>// Nessuna attività registrata.</div>}
            {[...(clients.find(c=>c.id===logClient.id)?.activityLog||[])].reverse().map(a=>(
              <div key={a.id} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px"}}>
                <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,marginBottom:2}}>{a.date}</div>
                <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.text}}>{a.text}</div>
              </div>
            ))}
          </div>
          <Label>Nuova nota</Label>
          <Textarea value={logText} onChange={e=>setLogText(e.target.value)} placeholder="Es. Chiamata fatta, inviato preventivo, riunione..." style={{minHeight:55,marginBottom:8}}/>
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setLogClient(null)}>Chiudi</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={addLog}>[ AGGIUNGI ]</Btn>
          </Row>
        </Modal>
      )}
      {modal && (
        <Modal title={editing?"Modifica Cliente":"Nuovo Cliente"} onClose={()=>setModal(false)}>
          <Grid cols={2} gap={8}>
            <div><Label>Nome</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Es. Vitamin Store"/></div>
            <div><Label>Contatto</Label><Input value={form.contact} onChange={e=>setForm({...form,contact:e.target.value})} placeholder="email / tel"/></div>
          </Grid>
          <Grid cols={2} gap={8}>
            <div><Label>Settore</Label><Select value={form.sector} onChange={e=>setForm({...form,sector:e.target.value})}>{SECTORS.map(s=><option key={s}>{s}</option>)}</Select></div>
            <div><Label>Fase</Label><Select value={form.stage} onChange={e=>setForm({...form,stage:e.target.value})}>{PROJECT_STAGES.map(s=><option key={s}>{s}</option>)}</Select></div>
          </Grid>

          {/* Canone mensile opzionale */}
          <div style={{background:C.accentDim,border:`1px solid ${C.borderHi}`,borderRadius:7,padding:12,marginBottom:12}}>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:14,color:C.accent,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8,fontWeight:700}}>🔄 Canone mensile (opzionale)</div>
            <Input type="number" value={form.monthlyFee||""} onChange={e=>setForm({...form,monthlyFee:e.target.value})} placeholder="Lascia vuoto se non c'è canone fisso" style={{marginBottom:0}}/>
          </div>

          {/* Rate/scadenze opzionali */}
          <div style={{background:`${C.gold}08`,border:`1px solid ${C.gold}33`,borderRadius:7,padding:12,marginBottom:12}}>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:14,color:C.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8,fontWeight:700}}>⚡ Rate / Scadenze (opzionale)</div>
            {form.installments.map((inst,i)=>(
              <Row key={inst.id} gap={6} style={{marginBottom:6,background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px"}}>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.gold}}>{fmtEur(inst.amount)}</div>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.textDim}}>{inst.dueDate} {inst.label?`— ${inst.label}`:""}</div>
                </div>
                <button onClick={()=>setForm({...form,installments:form.installments.filter(x=>x.id!==inst.id)})} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:16}}>×</button>
              </Row>
            ))}
            <Grid cols={2} gap={6}>
              <div><Label>Importo €</Label><Input type="number" value={instForm.amount} onChange={e=>setInstForm({...instForm,amount:e.target.value})} placeholder="Es. 500" style={{marginBottom:6}}/></div>
              <div><Label>Scadenza</Label><Input type="date" value={instForm.dueDate} onChange={e=>setInstForm({...instForm,dueDate:e.target.value})} style={{marginBottom:6}}/></div>
            </Grid>
            <Input value={instForm.label} onChange={e=>setInstForm({...instForm,label:e.target.value})} placeholder="Es. Acconto, Saldo, Rata 1..." style={{marginBottom:6}}/>
            <Btn size="sm" style={{width:"100%",justifyContent:"center"}} onClick={addInst}>+ Aggiungi rata</Btn>
          </div>


          <Label>Note</Label>
          <Textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} style={{minHeight:40,marginBottom:10}}/>
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setModal(false)}>Annulla</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={saveC}>{editing?"[ SALVA ]":"[ AGGIUNGI ]"}</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
};

// ─── FINANCE ─────────────────────────────────────────────────────────────────
const FinanceView = ({clients, payments, setPayments}) => {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const thisYear = String(now.getFullYear());
  const monthName = now.toLocaleDateString("it-IT",{month:"long",year:"numeric"}).toUpperCase();
  const todayISO = todayStr();

  // For recurring clients: check if marked paid this month
  const isMonthPaid = (clientId) => payments.some(p=>p.clientId===clientId && p.note===`canone-${thisMonth}`);
  const markPaid = (c) => {
    if(isMonthPaid(c.id)) return;
    const np={id:uid(),clientId:c.id,amount:parseFloat(c.monthly_fee||c.monthlyFee)||0,date:todayISO,note:`canone-${thisMonth}`,expectedId:`rec-${c.id}-${thisMonth}`};setPayments(prev=>[...prev,np]);pushItem('payments',np);
  };
  const unmarkPaid = (clientId) => {
    const toDelRec=payments.filter(p=>p.clientId===clientId && p.note===`canone-${thisMonth}`);
    setPayments(prev=>prev.filter(p=>!(p.clientId===clientId && p.note===`canone-${thisMonth}`)));
    toDelRec.forEach(p=>deleteItem('payments',p.id));
  };

  // For spot: check if installment paid
  const isInstPaid = (clientId, instId) => payments.some(p=>p.expectedId===`exp-${clientId}-${instId}`);
  const markInstPaid = (c, inst) => {
    if(isInstPaid(c.id, inst.id)) return;
    const ni2={id:uid(),clientId:c.id,amount:parseFloat(inst.amount)||0,date:todayISO,note:inst.label||'Rata',expectedId:`exp-${c.id}-${inst.id}`};setPayments(prev=>[...prev,ni2]);pushItem('payments',ni2);
  };
  const unmarkInstPaid = (clientId, instId) => setPayments(payments.filter(p=>p.expectedId!==`exp-${clientId}-${instId}`));

  const recurringClients = clients.filter(c=>{ const fee=c.monthly_fee||c.monthlyFee; return fee && parseFloat(fee)>0; });
  const spotClients = clients.filter(c=>c.installments?.length>0);

  // Stats
  const yearPayments = payments.filter(p=>p.date?.startsWith(thisYear));
  const yearTotal = yearPayments.reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  const monthPaidTotal = recurringClients.filter(c=>isMonthPaid(c.id)).reduce((s,c)=>s+(parseFloat(c.monthly_fee||c.monthlyFee)||0),0);
  const monthExpTotal = recurringClients.reduce((s,c)=>s+(parseFloat(c.monthly_fee||c.monthlyFee)||0),0);
  const forfPct = Math.min(Math.round(yearTotal/FORFETTARIO_CAP*100),100);

  const [manualModal, setManualModal] = useState(false);
  const [manualForm, setManualForm] = useState({clientId:"",amount:"",date:todayISO,note:""});
  const saveManual = () => {
    if(!manualForm.amount) return;
    const nm={id:uid(),...manualForm};setPayments(prev=>[...prev,nm]);pushItem('payments',nm);
    setManualModal(false);
    setManualForm({clientId:"",amount:"",date:todayISO,note:""});
  };

  const PayRow = ({label, name, amount, paid, onMark, onUnmark}) => (
    <div style={{background:paid?`${C.success}0a`:C.panel,border:`1px solid ${paid?C.success+"55":C.border}`,borderRadius:8,padding:"12px 14px",display:"flex",alignItems:"center",gap:10,transition:"all .3s",marginBottom:7}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,color:paid?C.success:C.text,fontSize:16}}>{name}</div>
        <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.textDim}}>{label}</div>
      </div>
      <div style={{fontFamily:"'Cinzel',serif",fontSize:17,color:paid?C.success:C.gold,fontWeight:700,flexShrink:0}}>{fmtEur(amount)}</div>
      {!paid
        ? <button onClick={onMark} style={{background:`${C.success}15`,border:`1px solid ${C.success}`,borderRadius:5,color:C.success,cursor:"pointer",padding:"7px 12px",fontFamily:"'Rajdhani',sans-serif",fontSize:14,fontWeight:700,flexShrink:0}}>✓ Ricevuto</button>
        : <button onClick={onUnmark} style={{background:"none",border:`1px solid ${C.success}44`,borderRadius:4,color:C.success,cursor:"pointer",padding:"5px 10px",fontFamily:"'Rajdhani',sans-serif",fontSize:12,flexShrink:0}}>✓ Annulla</button>
      }
    </div>
  );

  return (
    <div className="fi">
      {/* Header stats */}
      <Section title="Finanze" action={<Btn size="sm" variant="gold" onClick={()=>setManualModal(true)}>+ Extra</Btn>}>
        <Card glow color={forfPct>80?C.danger:C.gold} style={{marginBottom:14}}>
          <Grid cols={3} gap={10} style={{marginBottom:10}}>
            <div><Label>Incassato {thisYear}</Label><div style={{fontFamily:"'Cinzel',serif",fontSize:20,color:C.gold,lineHeight:1}}>{fmtEur(yearTotal)}</div></div>
            <div><Label>{monthName}</Label><div style={{fontFamily:"'Cinzel',serif",fontSize:20,color:monthPaidTotal===monthExpTotal&&monthExpTotal>0?C.success:C.accent,lineHeight:1}}>{fmtEur(monthPaidTotal)}<span style={{fontSize:12,color:C.textDim}}>/{fmtEur(monthExpTotal)}</span></div></div>
            <div><Label>Forfettario</Label><div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:forfPct>80?C.danger:forfPct>60?C.gold:C.success}}>{forfPct}%</div></div>
          </Grid>
          <ProgressBar pct={forfPct} color={forfPct>80?C.danger:C.gold} height={5}/>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.textMuted,marginTop:5}}>rimangono {fmtEur(FORFETTARIO_CAP-yearTotal)}</div>
        </Card>

        {/* Ricorrenti questo mese */}
        {recurringClients.length>0 && (
          <div style={{marginBottom:20}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:14,color:C.accent,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>🔄 Ricorrenti — {monthName}</div>
            {recurringClients.map(c=>(
              <PayRow key={c.id}
                label={`Canone mensile`}
                name={c.name}
                amount={parseFloat(c.monthly_fee||c.monthlyFee)||0}
                paid={isMonthPaid(c.id)}
                onMark={()=>markPaid(c)}
                onUnmark={()=>unmarkPaid(c.id)}
              />
            ))}
          </div>
        )}

        {/* Rate spot in scadenza */}
        {spotClients.some(c=>c.installments?.some(i=>!isInstPaid(c.id,i.id))) && (
          <div style={{marginBottom:20}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:14,color:C.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>⚡ Rate</div>
            {spotClients.map(c=>c.installments?.filter(i=>!isInstPaid(c.id,i.id)).map(inst=>(
              <PayRow key={inst.id}
                label={`${inst.label||"Rata"} · scad. ${inst.dueDate}`}
                name={c.name}
                amount={parseFloat(inst.amount)||0}
                paid={isInstPaid(c.id,inst.id)}
                onMark={()=>markInstPaid(c,inst)}
                onUnmark={()=>unmarkInstPaid(c.id,inst.id)}
              />
            )))}
          </div>
        )}

        {recurringClients.length===0 && spotClients.length===0 && (
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.textMuted,padding:"12px 0",textAlign:"center"}}>// Nessun cliente con pagamenti. Aggiungili in Clienti.</div>
        )}

        {/* Storico anno */}
        {yearPayments.length>0 && (
          <div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Storico {thisYear}</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {[...yearPayments].sort((a,b)=>b.date?.localeCompare(a.date||"")).map(p=>(
                <Row key={p.id} style={{background:`${C.success}08`,border:`1px solid ${C.success}22`,borderRadius:6,padding:"9px 12px",justifyContent:"space-between"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:14,color:C.text,fontWeight:600}}>{clients.find(c=>c.id===p.clientId)?.name||"Entrata"}</div>
                    {p.note&&!p.note.startsWith("canone-")&&<div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textDim}}>{p.note}</div>}
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textMuted}}>{p.date}</div>
                  </div>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:14,color:C.success,flexShrink:0,marginRight:8}}>{fmtEur(p.amount)}</div>
                  <button onClick={()=>{setPayments(prev=>prev.filter(x=>x.id!==p.id));deleteItem('payments',p.id);}} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:15}}>×</button>
                </Row>
              ))}
            </div>
          </div>
        )}
      </Section>

      {manualModal && (
        <Modal title="Entrata Extra" onClose={()=>setManualModal(false)}>
          <Label>Cliente (opz.)</Label>
          <Select value={manualForm.clientId} onChange={e=>setManualForm({...manualForm,clientId:e.target.value})}>
            <option value="">Nessuno / Altro</option>
            {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Label>Importo (€)</Label><Input type="number" value={manualForm.amount} onChange={e=>setManualForm({...manualForm,amount:e.target.value})} placeholder="Es. 500"/>
          <Label>Data</Label><Input type="date" value={manualForm.date} onChange={e=>setManualForm({...manualForm,date:e.target.value})}/>
          <Label>Descrizione</Label><Input value={manualForm.note} onChange={e=>setManualForm({...manualForm,note:e.target.value})} placeholder="Es. consulenza extra..."/>
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setManualModal(false)}>Annulla</Btn>
            <Btn variant="gold" style={{flex:2,justifyContent:"center"}} onClick={saveManual}>[ REGISTRA ]</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
};


// ─── LEADS ───────────────────────────────────────────────────────────────────
const LeadsView = ({leads, setLeads, apiKeys={}, onNeedKey=()=>{}}) => {
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({name:"",contact:"",sector:"Altro",stage:"Da contattare",source:"",website:"",notes:""});
  const open = l => { setEditing(l?l.id:null); setForm(l?{name:l.name||"",contact:l.contact||"",sector:l.sector||"Altro",stage:l.stage||"Da contattare",source:l.source||"",website:l.website||"",notes:l.notes||""}:{name:"",contact:"",sector:"Altro",stage:"Da contattare",source:"",website:"",notes:""}); setModal(true); };
  const saveL = () => {
    if(!form.name.trim())return;
    let sl;
    if(editing){ sl={...leads.find(l=>l.id===editing),...form}; setLeads(prev=>prev.map(l=>l.id===editing?sl:l)); }
    else{ sl={id:uid(),...form,created_at:todayStr()}; setLeads(prev=>[...prev,sl]); }
    pushItem("leads",sl);
    setModal(false);
  };
  const sc = {"Da contattare":C.textDim,"Contattato":C.accent,"In trattativa":C.gold,"Perso":C.danger,"Convertito":C.success};
  const grouped = LEAD_STAGES.reduce((a,s)=>{a[s]=leads.filter(l=>l.stage===s);return a;},{});
  const [subtab, setSubtab] = useState("pipeline");

  return (
    <div className="fi">
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[["pipeline","Pipeline"],["hunter","Cerca"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubtab(k)} style={{flex:1,background:subtab===k?C.accentDim:"transparent",border:`1px solid ${subtab===k?C.accent:C.border}`,borderRadius:5,color:subtab===k?C.accent:C.textDim,padding:"9px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:16,letterSpacing:"0.1em",textTransform:"uppercase",transition:"all .2s"}}>
            {l}
          </button>
        ))}
      </div>
      {subtab==="hunter" && <HunterView onAddToLeads={lead=>{setLeads(p=>[...p,lead]);pushItem("leads",lead);setSubtab("pipeline");}} apiKeys={apiKeys} onNeedKey={onNeedKey}/>}
      {subtab==="pipeline" && (
        <Section title="Pipeline" action={<Btn size="sm" onClick={()=>open(null)}>+ New</Btn>}>
          {leads.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,padding:"20px 0",textAlign:"center"}}>// Pipeline vuota. Inizia la caccia.</div>}
          {LEAD_STAGES.map(stage=>grouped[stage].length>0&&(
            <div key={stage} style={{marginBottom:18}}>
              <Row gap={7} style={{marginBottom:7}}>
                <Dot color={sc[stage]}/>
                <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:sc[stage],letterSpacing:"0.15em",textTransform:"uppercase"}}>{stage}</span>
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textMuted}}>({grouped[stage].length})</span>
              </Row>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {grouped[stage].map(l=>(
                  <Card key={l.id}>
                    <Row style={{alignItems:"flex-start",justifyContent:"space-between"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <Row gap={8} style={{marginBottom:4,flexWrap:"wrap"}}>
                          <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,color:C.text,fontSize:"clamp(13px,1.2vw,17px)"}}>{l.name}</span>
                          {l.contacted && <Chip color={C.success} borderColor={C.success}>Contattato</Chip>}
                        </Row>
                        <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textDim}}>{l.contact} · {l.sector}</div>
                        {l.website && <a href={l.website} target="_blank" rel="noopener noreferrer" style={{display:"block",fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.accent,marginTop:4,wordBreak:"break-all",textDecoration:"none"}}>🌐 {l.website}</a>}
                        {l.source && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,marginTop:2}}>src: {l.source}</div>}
                        {l.notes && <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:C.textMuted,marginTop:3,fontStyle:"italic"}}>{l.notes}</div>}
                      </div>
                      <Row gap={5} style={{flexShrink:0}}>
                        <button onClick={()=>setLeads(prev=>prev.map(x=>x.id===l.id?{...x,contacted:!x.contacted}:x))} style={{background:l.contacted?C.successDim:"transparent",border:`1px solid ${l.contacted?C.success:C.border}`,borderRadius:4,color:l.contacted?C.success:C.textDim,cursor:"pointer",padding:"3px 7px",fontSize:15,fontFamily:"'Rajdhani',sans-serif",transition:"all .2s"}}>{l.contacted?"✓":"Contatta"}</button>
                        <Btn variant="ghost" size="sm" onClick={()=>open(l)}>Edit</Btn>
                        <Btn variant="danger" size="sm" onClick={()=>{setLeads(prev=>prev.filter(x=>x.id!==l.id));deleteItem('leads',l.id);}}>Del</Btn>
                      </Row>
                    </Row>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </Section>
      )}
      {modal && (
        <Modal title={editing?"Modifica Lead":"Nuovo Lead"} onClose={()=>setModal(false)}>
          <Grid cols={2} gap={8}>
            <div><Label>Nome</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Es. Ristorante X"/></div>
            <div><Label>Contatto</Label><Input value={form.contact} onChange={e=>setForm({...form,contact:e.target.value})} placeholder="email / tel"/></div>
          </Grid>
          <Grid cols={2} gap={8}>
            <div><Label>Settore</Label><Input value={form.sector||""} onChange={e=>setForm({...form,sector:e.target.value})} placeholder="Es. Ristorazione, Retail..."/></div>
            <div><Label>Stato</Label><Select value={form.stage} onChange={e=>setForm({...form,stage:e.target.value})}>{LEAD_STAGES.map(s=><option key={s}>{s}</option>)}</Select></div>
          </Grid>
          <Label>Sito web</Label><Input value={form.website||""} onChange={e=>setForm({...form,website:e.target.value})} placeholder="https://..."/>
          <Label>Fonte</Label><Input value={form.source} onChange={e=>setForm({...form,source:e.target.value})} placeholder="Google Maps, passaparola..."/>
          <Label>Note</Label><Textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} style={{minHeight:44,marginBottom:10}}/>
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setModal(false)}>Annulla</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={saveL}>{editing?"[ SALVA ]":"[ AGGIUNGI ]"}</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
};

// ─── GOALS ───────────────────────────────────────────────────────────────────
const GoalInput = ({goal, onSave}) => {
  const [val, setVal] = useState(goal.current ?? "");
  useEffect(()=>{ setVal(goal.current ?? ""); }, [goal.current]);
  return (
    <Input type="number" value={val}
      onChange={e=>setVal(e.target.value)}
      onBlur={()=>onSave(goal.id, val)}
      onKeyDown={e=>{if(e.key==="Enter"){e.target.blur();}}}
      placeholder="Aggiorna valore..." style={{marginBottom:0,flex:1,fontSize:11}}/>
  );
};

const GoalsView = ({goals, setGoals}) => {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({title:"",target:"",unit:"",current:"",deadline:"",category:"Business"});
  const cats = ["Business","Salute","Finanze","Personale"];
  const catColor = {Business:C.accent,Salute:C.success,Finanze:C.gold,Personale:C.purple};

  const save = () => {
    if(!form.title.trim())return;
    const cur=parseFloat(form.current)||0;
    const tgt=parseFloat(form.target)||100;
    const ng={id:uid(),...form,current:cur,target:tgt,start:cur,done:false,created_at:todayStr()};
    setGoals(prev=>[...prev,ng]);
    pushItem("goals",ng);
    setModal(false);
    setForm({title:"",target:"",unit:"",current:"",deadline:"",category:"Business"});
  };
  const updateCurrent = (id, val) => {
    const num = val===""||val===null||val===undefined ? 0 : parseFloat(val);
    if(isNaN(num)) return;
    setGoals(prev=>{
      const updG=prev.map(g=>{
        if(g.id!==id) return g;
        const start = g.start!==undefined ? g.start : g.current;
        const descending = start > g.target;
        const done = descending ? num<=g.target : num>=g.target;
        return {...g,current:num,done};
      });
      pushItem('goals',updG.find(g=>g.id===id));
      return updG;
    });
  };
  const active = goals.filter(g=>!g.done);
  const completed = goals.filter(g=>g.done);

  return (
    <div className="fi">
      <Section title="Goals" action={<Btn size="sm" onClick={()=>setModal(true)}>+ New Goal</Btn>}>
        {active.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,padding:"20px 0",textAlign:"center"}}>// No active goals. Set your targets.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {active.map(g=>{
            const gStart = g.start!==undefined ? g.start : 0;
            const descending = gStart > g.target;
            let pct;
            if(descending){
              const total = gStart - g.target;
              pct = total>0 ? Math.min(Math.round((gStart-(g.current||0))/total*100),100) : 0;
            } else {
              pct = Math.min(Math.round((g.current||0)/(g.target||1)*100),100);
            }
            pct = Math.max(0,pct);
            const col = catColor[g.category]||C.accent;
            return (
              <Card key={g.id} glow color={col}>
                <Row style={{justifyContent:"space-between",marginBottom:5}}>
                  <div>
                    <Row gap={7} style={{marginBottom:3}}>
                      <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,color:C.text,fontSize:"clamp(13px,1.2vw,17px)"}}>{g.title}</span>
                      <Chip color={col} borderColor={col}>{g.category}</Chip>
                    </Row>
                    {g.deadline && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textMuted}}>deadline: {g.deadline}</div>}
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"'Cinzel',serif",fontSize:18,color:col,fontWeight:700}}>{pct}%</div>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted}}>{g.current}/{g.target} {g.unit}</div>
                  </div>
                </Row>
                <ProgressBar pct={pct} color={col} height={6} style={{marginBottom:10}}/>
                <Row gap={10} style={{alignItems:"center"}}>
                  <input type="range"
                    min={descending?g.target:0}
                    max={descending?gStart:(g.target||100)}
                    step={Math.max(1,Math.round((descending?gStart:(g.target||100))/100))}
                    value={g.current||0}
                    onChange={e=>updateCurrent(g.id,e.target.value)}
                    style={{flex:1,accentColor:col,cursor:"pointer",height:6}}/>
                  <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:14,color:col,minWidth:60,textAlign:"right"}}>{g.current||0}/{g.target}</span>
                  <Btn variant="danger" size="sm" onClick={()=>{setGoals(prev=>prev.filter(x=>x.id!==g.id));deleteItem('goals',g.id);}}>×</Btn>
                </Row>
              </Card>
            );
          })}
        </div>

        {completed.length>0 && (
          <div style={{marginTop:20}}>
            <Label>Completati ✦</Label>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:8}}>
              {completed.map(g=>(
                <Card key={g.id} style={{borderColor:C.success+"33"}}>
                  <Row style={{justifyContent:"space-between"}}>
                    <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.textDim,textDecoration:"line-through"}}>{g.title}</span>
                    <Row gap={6}>
                      <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.success}}>✓ Done</span>
                      <button onClick={()=>{setGoals(prev=>prev.filter(x=>x.id!==g.id));deleteItem('goals',g.id);}} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:14}}>×</button>
                    </Row>
                  </Row>
                </Card>
              ))}
            </div>
          </div>
        )}
      </Section>

      {modal && (
        <Modal title="New Goal" onClose={()=>setModal(false)}>
          <Label>Titolo</Label><Input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Es. Arrivare a €3k/mese"/>
          <Label>Categoria</Label>
          <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
            {cats.map(c=>(
              <button key={c} onClick={()=>setForm({...form,category:c})} style={{background:form.category===c?`${catColor[c]}22`:"transparent",border:`1px solid ${form.category===c?catColor[c]:C.border}`,borderRadius:4,color:form.category===c?catColor[c]:C.textDim,padding:"5px 10px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:16,letterSpacing:"0.1em",textTransform:"uppercase"}}>
                {c}
              </button>
            ))}
          </div>
          <Grid cols={2} gap={10}>
            <div><Label>Target</Label><Input type="number" value={form.target} onChange={e=>setForm({...form,target:e.target.value})} placeholder="Es. 3000"/></div>
            <div><Label>Unità</Label><Input value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} placeholder="€, kg, clienti..."/></div>
          </Grid>
          <Label>Valore attuale</Label><Input type="number" value={form.current} onChange={e=>setForm({...form,current:e.target.value})} placeholder="Da dove parti?"/>
          {form.current!==""&&form.target!==""&&!isNaN(parseFloat(form.current))&&!isNaN(parseFloat(form.target))&&(
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:parseFloat(form.current)>parseFloat(form.target)?C.orange:C.success,marginTop:-4,marginBottom:8}}>
              {parseFloat(form.current)>parseFloat(form.target)?`↓ Obiettivo in calo (da ${form.current} a ${form.target})`:`↑ Obiettivo in crescita (da ${form.current} a ${form.target})`}
            </div>
          )}
          <Label>Deadline (opz.)</Label><Input type="date" value={form.deadline} onChange={e=>setForm({...form,deadline:e.target.value})} style={{marginBottom:4}}/>
          <Row gap={8} style={{marginTop:10}}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setModal(false)}>Cancel</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={save}>[ CREATE GOAL ]</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
};

// ─── TASKS ───────────────────────────────────────────────────────────────────
const TasksView = ({tasks, setTasks, anthropicKey, onNeedKey, clients=[]}) => {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [taskClientId, setTaskClientId] = useState("");
  const [filter, setFilter] = useState("todo");
  const [clientFilter, setClientFilter] = useState("all"); // todo | done | all

  const parseAndAdd = async () => {
    if(!input.trim()) return;
    if(!anthropicKey) {
      // Add as plain task without AI
      const nt={id:uid(), text:input.trim(), done:false, xp:15, created_at:todayStr()}; setTasks(prev=>[...prev,nt]); pushItem("tasks",nt);
      setInput("");
      return;
    }
    setLoading(true);
    const raw = input.trim();
    setInput("");
    try {
      const res = await fetch("https://apify-worker.luciettiandrea.workers.dev/anthropic/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":anthropicKey},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:400,messages:[{role:"user",content:`Sei l'AI di Studio Brillo (freelance web design, Vicenza). L'utente scrive questo testo libero che contiene uno o più task da fare:
"${raw}"

Estrai i task e rispondi SOLO con JSON:
{"tasks":[{"text":"testo chiaro e actionable del task","xp":10}]}
XP da 5 a 25 in base alla difficoltà/importanza. Max 5 task. Niente altro oltre al JSON.`}]})});
      const d = await res.json();
      const p = JSON.parse((d.content?.[0]?.text||"{}").replace(/\`\`\`json|\`\`\`/g,"").trim());
      const newTasks = (p.tasks||[{text:raw,xp:15}]).map(t=>({id:uid(),text:t.text,xp:t.xp||15,done:false,created_at:todayStr(),client_id:taskClientId||null}));
      setTasks(prev=>[...prev,...newTasks]);
      newTasks.forEach(t=>pushItem("tasks",t));
    } catch {
      const newT = {id:uid(),text:raw,done:false,xp:15,created_at:todayStr(),client_id:taskClientId||null};
      setTasks(prev=>[...prev,newT]);
      pushItem("tasks",newT);
    } finally { setLoading(false); }
  };

  const toggle = (id) => {
    const task = tasks.find(t=>t.id===id);
    if(!task) return;
    const updatedTask = {...task, done:!task.done, done_at:!task.done?todayStr():null};
    setTasks(prev=>prev.map(t=>t.id===id?updatedTask:t));
    pushItem("tasks", updatedTask);
  };
  const del = (id) => {
    setTasks(prev=>prev.filter(t=>t.id!==id));
    deleteItem("tasks", id);
  };

  const todo = tasks.filter(t=>!t.done);
  const done = tasks.filter(t=>t.done);
  const shown = filter==="todo"?todo:filter==="done"?done:tasks;
  const totalXP = done.reduce((s,t)=>s+(t.xp||15),0);

  return (
    <div className="fi">
      <Section title="Task" action={
        <Row gap={6}>
          <Chip color={C.purple} borderColor={C.purple}>+{totalXP} XP</Chip>
          <Btn size="sm" variant="ghost" onClick={async()=>{const d=await DB.pullAll();if(d?.tasks)setTasks(d.tasks);}} style={{fontSize:13}}>🔄</Btn>
        </Row>
      }>
        <Card glow color={C.purple} style={{marginBottom:14}}>
          <Label>Scrivi in modo libero — AI converte in task</Label>
          <Textarea
            value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))parseAndAdd();}}
            placeholder="Es. devo mandare preventivo a Marco, sistemare il sito Vitamin Store, rispondere alle mail..."
            style={{minHeight:65,marginBottom:8}}
          />

          <Btn style={{width:"100%",justifyContent:"center",opacity:loading?.6:1,borderColor:C.purple,color:C.purple,background:`${C.purple}15`}} onClick={parseAndAdd} disabled={loading}>
            {loading?"[ AI sta elaborando... ]":"[ + AGGIUNGI TASK — ⌘+Enter ]"}
          </Btn>
        </Card>

        {/* Filter tabs */}
        <Row gap={6} style={{marginBottom:12}}>
          {[["todo","Da fare",todo.length],["done","Fatti",done.length],["all","Tutti",tasks.length]].map(([k,l,n])=>(
            <button key={k} onClick={()=>setFilter(k)} style={{background:filter===k?`${C.purple}22`:"transparent",border:`1px solid ${filter===k?C.purple:C.border}`,borderRadius:4,color:filter===k?C.purple:C.textDim,padding:"5px 12px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:16,letterSpacing:"0.1em",textTransform:"uppercase"}}>
              {l} {n>0&&<span style={{opacity:.7}}>({n})</span>}
            </button>
          ))}
        </Row>

        {shown.length===0 && (
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,padding:"16px 0",textAlign:"center"}}>
            {filter==="todo"?"// Nessun task da fare. Ottimo.":"// Nessun task qui."}
          </div>
        )}

        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {shown.map(t=>(
            <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:t.done?`${C.purple}08`:C.bg,border:`1px solid ${t.done?C.purple+"44":C.border}`,borderRadius:6,transition:"all .2s"}}>
              <button onClick={()=>toggle(t.id)} style={{width:17,height:17,borderRadius:3,border:`1px solid ${t.done?C.purple:C.borderHi}`,background:t.done?C.purple:"transparent",cursor:"pointer",flexShrink:0,fontSize:16,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}}>
                {t.done&&"✓"}
              </button>
              <span style={{flex:1,fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:t.done?C.textDim:C.text,textDecoration:t.done?"line-through":"none",lineHeight:1.4}}>{t.text}</span>
              <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:t.done?C.purple:C.textMuted,flexShrink:0}}>+{t.xp||15}xp</span>
              <button onClick={()=>del(t.id)} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:16,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
};

// ─── NOTES ───────────────────────────────────────────────────────────────────
const NotesView = ({notes, setNotes}) => {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [pinned, setPinned] = useState({});

  const add = () => {
    if(!input.trim())return;
    const nn={id:uid(),text:input.trim(),created_at:todayStr(),time:new Date().toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"})};
    setNotes(prev=>[nn,...prev]);
    pushItem("notes",nn);
    setInput("");
  };

  const filtered = notes.filter(n=>!search||n.text.toLowerCase().includes(search.toLowerCase()));
  const sorted = [...filtered].sort((a,b)=>(pinned[b.id]?1:0)-(pinned[a.id]?1:0));

  return (
    <div className="fi">
      <Section title="Quick Notes">
        <Card glow style={{marginBottom:16}}>
          <Textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))add();}} placeholder="Scrivi qualcosa da ricordare... ⌘+Enter per salvare" style={{minHeight:70,marginBottom:8}}/>
          <Btn style={{width:"100%",justifyContent:"center"}} onClick={add}>[ SALVA NOTA ]</Btn>
        </Card>
        <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cerca nelle note..." style={{marginBottom:12}}/>
        {sorted.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,padding:"20px 0",textAlign:"center"}}>// No notes yet.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {sorted.map(n=>(
            <Card key={n.id} style={{borderColor:pinned[n.id]?C.gold+"66":C.border}}>
              <Row style={{justifyContent:"space-between",marginBottom:6}}>
                <Row gap={6}>
                  {pinned[n.id] && <span style={{fontSize:10}}>📌</span>}
                  <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted}}>{n.created_at} {n.time}</span>
                </Row>
                <Row gap={6}>
                  <button onClick={()=>setPinned(p=>({...p,[n.id]:!p[n.id]}))} style={{background:"none",border:"none",cursor:"pointer",fontSize:16,opacity:.7}}>{pinned[n.id]?"📌":"📍"}</button>
                  <button onClick={()=>{navigator.clipboard.writeText(n.text);}} style={{background:"none",border:"none",color:C.textDim,cursor:"pointer",fontSize:16,fontFamily:"'Rajdhani',sans-serif"}}>COPY</button>
                  <button onClick={()=>{setNotes(prev=>prev.filter(x=>x.id!==n.id));deleteItem('notes',n.id);}} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:15,lineHeight:1}}>×</button>
                </Row>
              </Row>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.text,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{n.text}</div>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
};

// ─── WORKOUT ─────────────────────────────────────────────────────────────────
const WorkoutView = ({workoutLog, setWorkoutLog}) => {
  const today = todayStr();
  const log = workoutLog[today]||{};
  const upd = patch => setWorkoutLog(prev=>({...prev,[today]:{...(prev[today]||{}),...patch}}));
  const last7 = Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-i);const k=d.toISOString().slice(0,10);return {k,d:d.toLocaleDateString("it-IT",{weekday:"short",day:"numeric"}),log:workoutLog[k]};}).reverse();
  const streak = (()=>{let s=0,d=new Date();while(true){const k=d.toISOString().slice(0,10);if(workoutLog[k]?.done){s++;d.setDate(d.getDate()-1);}else break;}return s;})();

  return (
    <div className="fi">
      <Section title="Workout Tracker">
        <Card glow style={{marginBottom:16}}>
          <Label>Oggi — {new Date().toLocaleDateString("it-IT",{weekday:"long",day:"numeric",month:"long"})}</Label>
          <Grid cols={2} gap={8} style={{marginBottom:log.done?12:0}}>
            <button onClick={()=>upd({done:true})} style={{background:log.done?"#051a08":C.bg,border:`2px solid ${log.done?C.success:C.border}`,borderRadius:7,color:log.done?C.success:C.textDim,padding:"16px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:16,letterSpacing:"0.05em",transition:"all .2s",textAlign:"center"}}>
              <div style={{fontSize:26,marginBottom:5}}>💪</div>ALLENATO
            </button>
            <button onClick={()=>upd({done:false,type:"",note:""})} style={{background:log.done===false&&workoutLog[today]!==undefined?"#1a0505":C.bg,border:`2px solid ${log.done===false&&workoutLog[today]!==undefined?C.danger:C.border}`,borderRadius:7,color:log.done===false&&workoutLog[today]!==undefined?C.danger:C.textDim,padding:"16px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:16,letterSpacing:"0.05em",transition:"all .2s",textAlign:"center"}}>
              <div style={{fontSize:26,marginBottom:5}}>🛋️</div>SALTATO
            </button>
          </Grid>
          {log.done && <>
            <Label>Tipo</Label>
            <Select value={log.type||""} onChange={e=>upd({type:e.target.value})} style={{marginBottom:7}}>
              <option value="">Seleziona...</option>
              {WORKOUT_TYPES.map(t=><option key={t}>{t}</option>)}
            </Select>
            <Label>Note</Label>
            <Input value={log.note||""} onChange={e=>upd({note:e.target.value})} placeholder="Es. chest day, nuovo PR..." style={{marginBottom:0}}/>
          </>}
        </Card>

        <Grid cols={2} gap={8} style={{marginBottom:16}}>
          <Card style={{textAlign:"center",padding:"16px 8px"}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:34,color:streak>0?C.success:C.textDim,fontWeight:700,lineHeight:1}} className={streak>0?"rp":""}>
              {streak}
            </div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginTop:5}}>Streak giorni</div>
          </Card>
          <Card style={{textAlign:"center",padding:"16px 8px"}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:34,color:C.accent,fontWeight:700,lineHeight:1}}>
              {last7.filter(x=>x.log?.done).length}
            </div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginTop:5}}>Su 7 giorni</div>
          </Card>
        </Grid>

        <Card>
          <Label>Ultimi 7 giorni</Label>
          <Row gap={5} style={{justifyContent:"space-between",marginTop:8}}>
            {last7.map(({k,d,log})=>(
              <div key={k} style={{flex:1,textAlign:"center"}}>
                <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,marginBottom:6}}>{d.split(" ")[0]}</div>
                <div style={{aspectRatio:"1",borderRadius:5,background:log?.done?C.successDim:log?C.dangerDim:C.bg,border:`1px solid ${log?.done?C.success:log?C.danger:C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>
                  {log?.done?"💪":log?"🛋️":""}
                </div>
              </div>
            ))}
          </Row>
        </Card>
      </Section>
    </div>
  );
};

// ─── DIET ─────────────────────────────────────────────────────────────────────
const MEALS = [
  {id:"colazione",label:"Colazione",icon:"☕"},
  {id:"spuntino_mattina",label:"Spuntino mattina",icon:"🍎"},
  {id:"pranzo",label:"Pranzo",icon:"🍽"},
  {id:"spuntino_pome",label:"Spuntino pomeriggio",icon:"🥜"},
  {id:"cena",label:"Cena",icon:"🌙"},
];
const MEAL_STATUS = [
  {id:"ok",label:"Corretto",color:"#4caf50",icon:"✅"},
  {id:"sgarro",label:"Sgarrato",color:"#f44336",icon:"🍕"},
  {id:"saltato",label:"Saltato",color:"#ff9800",icon:"⏭"},
];

const DietView = ({dietLog, setDietLog}) => {
  const today = todayStr();
  const log = dietLog[today]||{meals:{}};
  const meals = log.meals||{};
  const setMeal = (mealId, status) => setDietLog(prev=>{const pl=prev[today]||{};const pm=pl.meals||{};return {...prev,[today]:{...pl,meals:{...pm,[mealId]:pm[mealId]===status?null:status}}};});
  const setMealNote = (mealId, note) => setDietLog(prev=>{const pl=prev[today]||{};return {...prev,[today]:{...pl,mealNotes:{...(pl.mealNotes||{}),[mealId]:note}}};});

  const last7 = Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-i);const k=d.toISOString().slice(0,10);return {k,short:d.toLocaleDateString("it-IT",{weekday:"short"}),log:dietLog[k]};}).reverse();

  const dayScore = (dayLog) => {
    if(!dayLog?.meals) return null;
    const vals = Object.values(dayLog.meals).filter(Boolean);
    if(!vals.length) return null;
    const ok = vals.filter(v=>v==="ok").length;
    const tot = vals.length;
    return Math.round(ok/tot*100);
  };

  return (
    <div className="fi">
      <Section title="Dieta">
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
          {MEALS.map(meal=>{
            const status = meals[meal.id];
            const note = log.mealNotes?.[meal.id]||"";
            return (
              <Card key={meal.id} style={{borderColor:status==="ok"?C.success+"55":status==="sgarro"?C.danger+"55":status==="saltato"?C.orange+"55":C.border}}>
                <Row style={{justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <Row gap={10}>
                    <span style={{fontSize:20}}>{meal.icon}</span>
                    <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:16,color:C.text}}>{meal.label}</span>
                  </Row>
                  <Row gap={5}>
                    {MEAL_STATUS.map(s=>(
                      <button key={s.id} onClick={()=>setMeal(meal.id,s.id)} style={{background:status===s.id?s.color+"22":"transparent",border:`1px solid ${status===s.id?s.color:C.border}`,borderRadius:5,color:status===s.id?s.color:C.textDim,padding:"5px 10px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:13,fontWeight:600,transition:"all .2s"}}>
                        {s.icon}
                      </button>
                    ))}
                  </Row>
                </Row>
                {status && (
                  <Input value={note} onChange={e=>setMealNote(meal.id,e.target.value)} placeholder="Note opzionali..." style={{marginBottom:0,fontSize:13}}/>
                )}
              </Card>
            );
          })}
        </div>

        <Card>
          <Label>Ultimi 7 giorni</Label>
          <Row gap={5} style={{justifyContent:"space-between",marginTop:8}}>
            {last7.map(({k,short,log})=>{
              const score = dayScore(log);
              const color = score===null?C.border:score>=80?C.success:score>=50?C.gold:C.danger;
              return (
                <div key={k} style={{flex:1,textAlign:"center"}}>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.textMuted,marginBottom:5}}>{short}</div>
                  <div style={{aspectRatio:"1",borderRadius:5,background:score===null?C.bg:`${color}22`,border:`1px solid ${color}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Share Tech Mono',monospace",fontSize:score===null?12:14,color:score===null?C.textMuted:color,fontWeight:700}}>
                    {score===null?"—":`${score}%`}
                  </div>
                </div>
              );
            })}
          </Row>
        </Card>
      </Section>
    </div>
  );
};

// ─── MOOD ─────────────────────────────────────────────────────────────────────
const MoodView = ({moodLog, setMoodLog}) => {
  const today = todayStr();
  const log = moodLog[today]||{scores:{},emoji:"",note:""};
  const upd = patch => setMoodLog(prev=>({...prev,[today]:{...(prev[today]||{}),...patch}}));
  const setScore = (k,v) => upd({scores:{...log.scores,[k]:v}});
  const avg = Object.values(log.scores||{}).length ? (Object.values(log.scores).reduce((a,b)=>a+b,0)/Object.values(log.scores).length).toFixed(1) : null;
  const last7 = Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-i);const k=d.toISOString().slice(0,10);const l=moodLog[k];const a=l?.scores?Object.values(l.scores).reduce((x,y)=>x+y,0)/Object.values(l.scores).length:null;return {k,d:d.toLocaleDateString("it-IT",{weekday:"short"}),avg:a,emoji:l?.emoji};}).reverse();

  return (
    <div className="fi">
      <Section title="Daily Check-in">
        <Card style={{marginBottom:12}}>
          <Label>Come ti senti oggi?</Label>
          <div style={{display:"flex",flexWrap:"wrap",gap:7,marginTop:4}}>
            {MOOD_EMOJIS.map(e=>(
              <button key={e} onClick={()=>upd({emoji:e})} style={{background:log.emoji===e?C.borderHi:"transparent",border:`1px solid ${log.emoji===e?C.borderHi:C.border}`,borderRadius:6,padding:"7px 9px",cursor:"pointer",fontSize:20,transition:"all .2s",lineHeight:1}}>
                {e}
              </button>
            ))}
          </div>
        </Card>

        <Card glow style={{marginBottom:12}}>
          <Label>Rating (1-5)</Label>
          <div style={{display:"flex",flexDirection:"column",gap:12,marginTop:8}}>
            {MOOD_METRICS.map(({k,label,icons})=>(
              <div key={k}>
                <Row style={{justifyContent:"space-between",marginBottom:7}}>
                  <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:C.textDim,letterSpacing:"0.1em",textTransform:"uppercase"}}>{label}</span>
                  <span style={{fontSize:18}}>{icons[(log.scores?.[k]||1)-1]}</span>
                </Row>
                <Row gap={5}>
                  {[1,2,3,4,5].map(v=>(
                    <button key={v} onClick={()=>setScore(k,v)} style={{flex:1,background:log.scores?.[k]===v?C.accentDim:C.bg,border:`1px solid ${log.scores?.[k]===v?C.accent:C.border}`,borderRadius:4,color:log.scores?.[k]===v?C.accent:C.textDim,padding:"7px 2px",cursor:"pointer",fontFamily:"'Share Tech Mono',monospace",fontSize:16,transition:"all .2s"}}>
                      {v}
                    </button>
                  ))}
                </Row>
              </div>
            ))}
          </div>
          {avg && (
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:C.bg,borderRadius:5,border:`1px solid ${C.border}`,marginTop:14}}>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:24,color:avg>=4?C.success:avg>=3?C.gold:C.danger,fontWeight:700}}>{avg}</div>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:"clamp(9px,0.9vw,13px)",color:C.textDim,letterSpacing:"0.1em",textTransform:"uppercase"}}>Media giornaliera</div>
            </div>
          )}
        </Card>

        <Card style={{marginBottom:12}}>
          <Label>Nota libera</Label>
          <Textarea value={log.note||""} onChange={e=>upd({note:e.target.value})} placeholder="Come stai davvero? Cosa ti pesa? Cosa ti carica?" style={{minHeight:70,marginBottom:0}}/>
        </Card>

        <Card>
          <Label>Ultimi 7 giorni</Label>
          <Row gap={5} style={{justifyContent:"space-between",marginTop:8}}>
            {last7.map(({k,d,avg,emoji})=>(
              <div key={k} style={{flex:1,textAlign:"center"}}>
                <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,marginBottom:5}}>{d}</div>
                <div style={{fontSize:18,marginBottom:4}}>{emoji||"—"}</div>
                {avg!==null && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:avg>=4?C.success:avg>=3?C.gold:C.danger}}>{avg.toFixed(1)}</div>}
              </div>
            ))}
          </Row>
        </Card>
      </Section>
    </div>
  );
};

// ─── ASTRO HELPERS ────────────────────────────────────────────────────────────
const NATAL_DATA = {sun:294,moon:186,asc:285};
const ZODIAC_SIGNS = ['Ariete','Toro','Gemelli','Cancro','Leone','Vergine','Bilancia','Scorpione','Sagittario','Capricorno','Acquario','Pesci'];

const getJulianDay = (date) => {
  const y=date.getUTCFullYear(),m=date.getUTCMonth()+1,d=date.getUTCDate();
  const h=date.getUTCHours()+date.getUTCMinutes()/60;
  let Y=y,M=m; if(M<=2){Y--;M+=12;}
  const A=Math.floor(Y/100),B=2-A+Math.floor(A/4);
  return Math.floor(365.25*(Y+4716))+Math.floor(30.6001*(M+1))+d+h/24+B-1524.5;
};

const getPlanetPositions = (jd) => {
  const T=(jd-2451545.0)/36525;
  let L=280.46646+36000.76983*T;
  let Msun=357.52911+35999.05029*T-0.0001537*T*T;
  const Mrad=Msun*Math.PI/180;
  const C=(1.914602-0.004817*T)*Math.sin(Mrad)+0.019993*Math.sin(2*Mrad);
  const sun=((L+C)%360+360)%360;
  let Lm=218.3165+481267.8813*T;
  let Mm=(134.9634+477198.8676*T)*Math.PI/180;
  let D=(297.8502+445267.1115*T)*Math.PI/180;
  const moon=((Lm+6.289*Math.sin(Mm)-1.274*Math.sin(2*D-Mm)+0.658*Math.sin(2*D))%360+360)%360;
  const mercury=((252.250906+149474.0722491*T+1.914602*Math.sin(Mrad))%360+360)%360;
  const Mv=(212.7+58517.8*T)*Math.PI/180;
  const venus=((181.979801+58519.2130302*T+0.7758*Math.sin(Mv))%360+360)%360;
  const Mma=(19.3729+19140.3*T)*Math.PI/180;
  const mars=((355.433+19141.6964471*T+1.849*Math.sin(Mma))%360+360)%360;
  const Mj=(20.9+3034.9*T)*Math.PI/180;
  const jupiter=((34.351519+3034.9056606*T+5.555*Math.sin(Mj))%360+360)%360;
  const Ms=(317.0+1222.1*T)*Math.PI/180;
  const saturn=((50.077444+1223.5110686*T+6.397*Math.sin(Ms))%360+360)%360;
  return {sun,moon,mercury,venus,mars,jupiter,saturn};
};

const getZodiacSign = deg => ZODIAC_SIGNS[Math.floor(((deg%360)+360)%360/30)];
const getPlanetDeg = deg => Math.floor(((deg%360)+360)%360%30);
const getAspect = (t,n) => { const d=Math.abs(t-n+360)%360; const o=Math.min(d,360-d); if(o<8)return 'congiunzione'; if(Math.abs(o-60)<6)return 'sestile'; if(Math.abs(o-90)<7)return 'quadratura'; if(Math.abs(o-120)<8)return 'trigono'; if(Math.abs(o-180)<8)return 'opposizione'; return null; };

const buildHoroscopePrompt = (pos, dateStr) => {
  const planets = [
    ['Sole',pos.sun],['Luna',pos.moon],['Mercurio',pos.mercury],
    ['Venere',pos.venus],['Marte',pos.mars],['Giove',pos.jupiter],['Saturno',pos.saturn]
  ].map(([n,p])=>{
    const sign=getZodiacSign(p), deg=getPlanetDeg(p), asp=getAspect(p,NATAL_DATA.sun);
    return `${n}: ${sign} ${deg}°${asp?` (${asp} al Sole natale)`:''}`;
  }).join('\n');
  return `Sei un astrologo esperto. Oggi è ${dateStr}.

Tema natale di Andrea (Vicenza, 14 gennaio 1996, ore 6:30):
- Sole: Capricorno 24°
- Ascendente: Capricorno
- Luna: Bilancia

Transiti di oggi:
${planets}

Scrivi una lettura astrologica giornaliera personalizzata in italiano. Tono diretto, concreto, non generico. Parla in seconda persona (tu). Tre sezioni brevi: Lavoro, Relazioni, Energia. Max 180 parole totali. Niente markdown, solo testo plain.`;
};

// ─── DIARIO / STORICO ─────────────────────────────────────────────────────────
const DiaryView = ({moodLog, setMoodLog, dietLog, setDietLog, smokeLog, setSmokeLog, workoutLog, setWorkoutLog, focusLog={}, setFocusLog, anthropicKey}) => {
  const todayK = todayStr();
  const [selected, setSelected] = useState(todayK);
  const [viewMonth, setViewMonth] = useState(()=>{const d=new Date();return {y:d.getFullYear(),m:d.getMonth()};});

  const mood = moodLog[selected]||{scores:{},emoji:"",note:"",diary:""};
  const diet = dietLog[selected]||{meals:{},mealNotes:{}};
  const cigs = smokeLog[selected]||0;
  const wo = workoutLog[selected];
  const focusVal = focusLog[selected]??null;
  const setFocus = val => setFocusLog(prev=>({...prev,[selected]:prev[selected]===val?null:val}));
  const [horoscope, setHoroscope] = useState(null);
  const [horoscopeLoading, setHoroscopeLoading] = useState(false);
  const [horoscopeDate, setHoroscopeDate] = useState(null);

  const generateHoroscope = async () => {
    if(!anthropicKey) return;
    setHoroscopeLoading(true);
    try {
      const now = selected===todayK ? new Date() : new Date(selected+'T12:00:00');
      const jd = getJulianDay(now);
      const pos = getPlanetPositions(jd);
      const dateStr = now.toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'});
      const prompt = buildHoroscopePrompt(pos, dateStr);
      const res = await fetch("https://apify-worker.luciettiandrea.workers.dev/anthropic/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":anthropicKey},
        body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:400,messages:[{role:"user",content:prompt}]})
      });
      const d = await res.json();
      setHoroscope(d.content?.[0]?.text||"Errore nella lettura.");
      setHoroscopeDate(selected);
    } catch(e){ setHoroscope("Errore: "+e.message); }
    setHoroscopeLoading(false);
  };

  const updMood = patch => setMoodLog(prev=>({...prev,[selected]:{...(prev[selected]||{}),...patch}}));
  const setCigs = n => setSmokeLog(prev=>({...prev,[selected]:Math.max(0,n)}));
  const setMeal = (mealId, status) => setDietLog(prev=>{const pl=prev[selected]||{};const pm=pl.meals||{};return {...prev,[selected]:{...pl,meals:{...pm,[mealId]:pm[mealId]===status?null:status}}};});
  const updWorkout = patch => setWorkoutLog(prev=>({...prev,[selected]:{...(prev[selected]||{}),...patch}}));

  const moodAvg = Object.values(mood.scores||{}).length ? (Object.values(mood.scores).reduce((a,b)=>a+b,0)/Object.values(mood.scores).length).toFixed(1) : null;

  const firstDay = new Date(viewMonth.y, viewMonth.m, 1);
  const startWeekday = (firstDay.getDay()+6)%7;
  const daysInMonth = new Date(viewMonth.y, viewMonth.m+1, 0).getDate();
  const monthName = firstDay.toLocaleDateString("it-IT",{month:"long",year:"numeric"});
  const cells = [];
  for(let i=0;i<startWeekday;i++) cells.push(null);
  for(let d=1;d<=daysInMonth;d++){
    const k = `${viewMonth.y}-${String(viewMonth.m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    cells.push(k);
  }

  const dayHasData = k => {
    const m=moodLog[k]; const di=dietLog[k]; const c=smokeLog[k];
    return (m&&(m.emoji||m.note||m.diary||Object.keys(m.scores||{}).length)) || (di&&Object.values(di.meals||{}).some(Boolean)) || c>0;
  };
  const dayEmoji = k => moodLog[k]?.emoji||"";

  const prevMonth = () => setViewMonth(v=>v.m===0?{y:v.y-1,m:11}:{y:v.y,m:v.m-1});
  const nextMonth = () => setViewMonth(v=>v.m===11?{y:v.y+1,m:0}:{y:v.y,m:v.m+1});

  const selDate = new Date(selected+"T00:00:00");
  const selLabel = selDate.toLocaleDateString("it-IT",{weekday:"long",day:"numeric",month:"long"});

  return (
    <div className="fi">
      <Section title="📓 Diario">
        <Card style={{marginBottom:14}}>
          <Row style={{justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <button onClick={prevMonth} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,color:C.text,cursor:"pointer",padding:"4px 12px",fontSize:16}}>‹</button>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.accent,letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:700}}>{monthName}</div>
            <button onClick={nextMonth} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,color:C.text,cursor:"pointer",padding:"4px 12px",fontSize:16}}>›</button>
          </Row>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
            {["L","M","M","G","V","S","D"].map((d,i)=>(
              <div key={i} style={{textAlign:"center",fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textMuted,padding:"2px 0"}}>{d}</div>
            ))}
            {cells.map((k,i)=>{
              if(!k) return <div key={i}/>;
              const day = parseInt(k.slice(-2));
              const isToday = k===todayK;
              const isSel = k===selected;
              const hasData = dayHasData(k);
              const emoji = dayEmoji(k);
              const isFuture = k>todayK;
              return (
                <button key={i} onClick={()=>!isFuture&&setSelected(k)} disabled={isFuture}
                  style={{aspectRatio:"1",background:isSel?C.accentDim:hasData?`${C.success}11`:C.bg,border:`1px solid ${isSel?C.accent:isToday?C.gold:hasData?C.success+"44":C.border}`,borderRadius:6,color:isFuture?C.textMuted+"55":isSel?C.accent:C.text,cursor:isFuture?"default":"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:2,opacity:isFuture?.3:1,transition:"all .15s"}}>
                  <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,fontWeight:isToday?700:400}}>{day}</span>
                  {emoji && <span style={{fontSize:11,lineHeight:1}}>{emoji}</span>}
                </button>
              );
            })}
          </div>
        </Card>

        <div style={{fontFamily:"'Cinzel',serif",fontSize:15,color:C.gold,textTransform:"capitalize",marginBottom:12,letterSpacing:"0.05em"}}>{selLabel}{selected===todayK?" · oggi":""}</div>

        <Card glow style={{marginBottom:12}}>
          <Label>Diario</Label>
          <Textarea value={mood.diary||""} onChange={e=>updMood({diary:e.target.value})} placeholder="Com'è andata oggi? Pensieri, eventi, riflessioni..." style={{minHeight:120,marginBottom:0}}/>
        </Card>

        <Card style={{marginBottom:12,borderColor:"#9b59b622",background:"#9b59b606"}}>
          <Label style={{color:"#ce93d8"}}>⚰️ Il mio necrologio di oggi</Label>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textMuted,marginBottom:8}}>Scrivi al passato — brutalmente onesto su come hai vissuto le ultime 24 ore</div>
          <Textarea
            value={mood.obituary||""}
            onChange={e=>updMood({obituary:e.target.value})}
            placeholder={`Qui giace ${selected===todayStr()?"qualcuno":"qualcuno"} che oggi ha...`}
            style={{minHeight:100,marginBottom:0,borderColor:"#9b59b644"}}/>
        </Card>

        <Card style={{marginBottom:12}}>
          <Label>6 cose per cui sono grato</Label>
          <div style={{display:"flex",flexDirection:"column",gap:7,marginTop:4}}>
            {[0,1,2,3,4,5].map(i=>(
              <Row key={i} gap={8} style={{alignItems:"center"}}>
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.gold,flexShrink:0,width:18}}>{i+1}.</span>
                <Input
                  value={(mood.gratitude||[])[i]||""}
                  onChange={e=>{const g=[...((mood.gratitude)||["","","","","",""])];g[i]=e.target.value;updMood({gratitude:g});}}
                  placeholder={["Oggi sono grato per...","Una persona che apprezzo...","Qualcosa che ho imparato...","Un momento bello di oggi...","Una cosa che funziona bene nella mia vita...","Qualcosa di piccolo ma prezioso..."][i]}
                  style={{marginBottom:0,flex:1}}/>
              </Row>
            ))}
          </div>
        </Card>

        <Card style={{marginBottom:12,borderColor:C.gold+"55",background:`${C.gold}06`}}>
          <Label style={{color:C.gold}}>Lo sto diventando</Label>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textMuted,marginBottom:8}}>Scrivi al presente — come se fosse già vero</div>
          <Textarea
            value={mood.affirmation||""}
            onChange={e=>updMood({affirmation:e.target.value})}
            placeholder="Es. Sono una persona disciplinata che costruisce ogni giorno la versione migliore di sé..."
            style={{minHeight:80,marginBottom:0,borderColor:C.gold+"44"}}/>
        </Card>

        <Card style={{marginBottom:12,borderColor:"#4fc3f744",background:"#4fc3f706"}}>
          <Label style={{color:"#4fc3f7"}}>🌱 Kaizen — Piccole domande, grandi cambiamenti</Label>
          <div style={{display:"flex",flexDirection:"column",gap:14,marginTop:8}}>
            {[
              {area:"💼 Lavoro", q:"Qual è la cosa più piccola che posso fare oggi per far avanzare un progetto?", k:"kaizen_lavoro"},
              {area:"💪 Salute", q:"Cosa posso fare oggi, anche di minimo, per trattare meglio il mio corpo?", k:"kaizen_salute"},
              {area:"🧠 Mindset", q:"Qual è un pensiero limitante che posso sfidare oggi con un'azione piccola?", k:"kaizen_mindset"},
              {area:"❤️ Relazioni", q:"Chi potrei contattare o ringraziare oggi, anche con un solo messaggio?", k:"kaizen_relazioni"},
            ].map(({area,q,k})=>(
              <div key={k}>
                <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:13,fontWeight:700,color:"#4fc3f7",marginBottom:2}}>{area}</div>
                <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.textDim,marginBottom:6,fontStyle:"italic"}}>{q}</div>
                <Textarea
                  value={mood[k]||""}
                  onChange={e=>updMood({[k]:e.target.value})}
                  placeholder="Scrivi qui la tua risposta..."
                  style={{minHeight:60,marginBottom:0,fontSize:13}}/>
              </div>
            ))}
          </div>
        </Card>

        <Card style={{marginBottom:12}}>
          <Label>Umore</Label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:4}}>
            {MOOD_EMOJIS.map(e=>(
              <button key={e} onClick={()=>updMood({emoji:e})} style={{background:mood.emoji===e?C.borderHi:"transparent",border:`1px solid ${mood.emoji===e?C.borderHi:C.border}`,borderRadius:6,padding:"6px 8px",cursor:"pointer",fontSize:18,lineHeight:1}}>{e}</button>
            ))}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:14}}>
            {MOOD_METRICS.map(({k,label,icons})=>(
              <div key={k}>
                <Row style={{justifyContent:"space-between",marginBottom:5}}>
                  <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:14,color:C.textDim,letterSpacing:"0.08em",textTransform:"uppercase"}}>{label}</span>
                  <span style={{fontSize:16}}>{icons[(mood.scores?.[k]||1)-1]}</span>
                </Row>
                <Row gap={5}>
                  {[1,2,3,4,5].map(v=>(
                    <button key={v} onClick={()=>updMood({scores:{...mood.scores,[k]:v}})} style={{flex:1,background:mood.scores?.[k]===v?C.accentDim:C.bg,border:`1px solid ${mood.scores?.[k]===v?C.accent:C.border}`,borderRadius:4,color:mood.scores?.[k]===v?C.accent:C.textDim,padding:"6px 2px",cursor:"pointer",fontFamily:"'Share Tech Mono',monospace",fontSize:14}}>{v}</button>
                  ))}
                </Row>
              </div>
            ))}
          </div>
          {moodAvg && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.textDim,marginTop:10}}>Media: <span style={{color:moodAvg>=4?C.success:moodAvg>=3?C.gold:C.danger}}>{moodAvg}</span></div>}
        </Card>

        <Card style={{marginBottom:12}}>
          <Label>Dieta</Label>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:6}}>
            {MEALS.map(meal=>(
              <Row key={meal.id} style={{justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:14,color:C.textDim}}>{meal.icon} {meal.label}</span>
                <Row gap={4}>
                  {MEAL_STATUS.map(st=>(
                    <button key={st.id} onClick={()=>setMeal(meal.id,st.id)} style={{background:diet.meals?.[meal.id]===st.id?st.color+"22":C.bg,border:`1px solid ${diet.meals?.[meal.id]===st.id?st.color:C.border}`,borderRadius:4,cursor:"pointer",padding:"4px 6px",fontSize:14,lineHeight:1}}>{st.icon}</button>
                  ))}
                </Row>
              </Row>
            ))}
          </div>
        </Card>

        <Card style={{marginBottom:12}}>
          <Row style={{justifyContent:"space-between",alignItems:"center"}}>
            <Label style={{marginBottom:0}}>🚬 Sigarette</Label>
            <Row gap={10} style={{alignItems:"center"}}>
              <button onClick={()=>setCigs(cigs-1)} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,color:C.text,cursor:"pointer",width:38,height:38,fontSize:20,fontWeight:700}}>−</button>
              <span style={{fontFamily:"'Cinzel',serif",fontSize:28,fontWeight:900,color:cigs>15?C.danger:cigs>8?C.orange:C.gold,minWidth:40,textAlign:"center"}}>{cigs}</span>
              <button onClick={()=>setCigs(cigs+1)} style={{background:C.accentDim,border:`1px solid ${C.accent}`,borderRadius:6,color:C.accent,cursor:"pointer",width:38,height:38,fontSize:20,fontWeight:700}}>+</button>
            </Row>
          </Row>
        </Card>

        <Card style={{marginBottom:12}}>
          <Label>💭 Pensieri intrusivi oggi?</Label>
          <Grid cols={2} gap={8} style={{marginTop:6}}>
            <button onClick={()=>setFocus(true)} style={{background:focusVal===true?"#051a08":C.bg,border:`2px solid ${focusVal===true?C.success:C.border}`,borderRadius:7,color:focusVal===true?C.success:C.textDim,padding:"12px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:14,transition:"all .2s",textAlign:"center"}}>
              <div style={{fontSize:22,marginBottom:4}}>🧠</div>NO — streak!
            </button>
            <button onClick={()=>setFocus(false)} style={{background:focusVal===false?"#1a0505":C.bg,border:`2px solid ${focusVal===false?C.danger:C.border}`,borderRadius:7,color:focusVal===false?C.danger:C.textDim,padding:"12px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:14,transition:"all .2s",textAlign:"center"}}>
              <div style={{fontSize:22,marginBottom:4}}>💀</div>SÌ — azzera
            </button>
          </Grid>
          {focusVal!==null && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:focusVal?C.success:C.danger,marginTop:8,textAlign:"center"}}>{focusVal?"✓ Nessun pensiero intrusivo":"✗ Pensieri intrusivi presenti"}</div>}
        </Card>

        <Card>
          <Label>Allenamento</Label>
          <Grid cols={2} gap={8} style={{marginBottom:(wo?.done)?12:0}}>
            <button onClick={()=>updWorkout({done:true})} style={{background:wo?.done?"#051a08":C.bg,border:`2px solid ${wo?.done?C.success:C.border}`,borderRadius:7,color:wo?.done?C.success:C.textDim,padding:"12px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:14,transition:"all .2s",textAlign:"center"}}>
              <div style={{fontSize:22,marginBottom:4}}>💪</div>ALLENATO
            </button>
            <button onClick={()=>updWorkout({done:false,type:"",note:""})} style={{background:wo?.done===false?"#1a0505":C.bg,border:`2px solid ${wo?.done===false?C.danger:C.border}`,borderRadius:7,color:wo?.done===false?C.danger:C.textDim,padding:"12px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:14,transition:"all .2s",textAlign:"center"}}>
              <div style={{fontSize:22,marginBottom:4}}>🛋️</div>SALTATO
            </button>
          </Grid>
          {wo?.done && <>
            <Label>Tipo</Label>
            <Select value={wo.type||""} onChange={e=>updWorkout({type:e.target.value})} style={{marginBottom:7}}>
              <option value="">Seleziona...</option>
              {WORKOUT_TYPES.map(t=><option key={t}>{t}</option>)}
            </Select>
            <Label>Note</Label>
            <Input value={wo.note||""} onChange={e=>updWorkout({note:e.target.value})} placeholder="Es. chest day, nuovo PR..." style={{marginBottom:0}}/>
          </>}
        </Card>
        <Card style={{marginTop:12,borderColor:C.purple+"44",background:`${C.purple}06`}}>
          <Row style={{justifyContent:"space-between",alignItems:"center",marginBottom:horoscope&&horoscopeDate===selected?12:0}}>
            <Label style={{color:"#ce93d8",marginBottom:0}}>♑ Oroscopo del giorno</Label>
            <Btn size="sm" onClick={generateHoroscope} disabled={!anthropicKey||horoscopeLoading} style={{borderColor:"#ce93d8",color:"#ce93d8",opacity:anthropicKey?1:0.4}}>
              {horoscopeLoading?"...":"✦ Genera"}
            </Btn>
          </Row>
          {horoscope && horoscopeDate===selected && (
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.text,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{horoscope}</div>
          )}
          {!anthropicKey && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textMuted,marginTop:4}}>Configura la chiave Anthropic dal tasto API</div>}
        </Card>

      </Section>
    </div>
  );
};

// ─── SLOT ─────────────────────────────────────────────────────────────────────
const SlotView = ({slotDays, slotStart, onReset}) => {
  const ms = [1,3,7,14,30,60,90,180,365];
  const next = ms.find(m=>m>slotDays)||365;
  const prev = [...ms].reverse().find(m=>m<=slotDays)||0;
  const pct = prev===next?100:Math.round((slotDays-prev)/(next-prev)*100);
  const col = slotDays>=365?C.gold:slotDays>=90?C.purple:slotDays>=30?C.accent:slotDays>=7?C.success:C.danger;
  return (
    <div className="fi">
      <Section title="Discipline Tracker">
        <Card glow style={{textAlign:"center",padding:"28px 16px",marginBottom:14}}>
          <Label>Giorni senza slot</Label>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:64,fontWeight:900,color:col,lineHeight:1,textShadow:`0 0 24px ${col}55`,marginTop:8}} className="rp">{slotDays}</div>
          {slotStart && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textMuted,marginTop:8}}>dal {new Date(slotStart).toLocaleDateString("it-IT")}</div>}
          <div style={{marginTop:16}}>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.textDim,letterSpacing:"0.15em",marginBottom:6}}>NEXT MILESTONE: {next}d</div>
            <ProgressBar pct={pct} color={col}/>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,marginTop:4}}>{pct}% to {next}d</div>
          </div>
        </Card>
        <Card style={{marginBottom:14}}>
          <Label>Milestones</Label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
            {ms.map(m=>(
              <div key={m} style={{padding:"5px 10px",borderRadius:4,border:`1px solid ${slotDays>=m?col:C.border}`,background:slotDays>=m?`${col}11`:"transparent",fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:slotDays>=m?col:C.textMuted}}>
                {m}d{slotDays>=m?" ✓":""}
              </div>
            ))}
          </div>
        </Card>
        <div style={{background:C.dangerDim,border:`1px solid ${C.danger}33`,borderRadius:8,padding:14}}>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:C.danger,marginBottom:6,letterSpacing:"0.1em"}}>⚠ RESET</div>
          <button onClick={onReset} style={{width:"100%",background:"none",border:`1px solid ${C.danger}`,borderRadius:5,color:C.danger,padding:"10px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:16,letterSpacing:"0.1em",textTransform:"uppercase"}}>
            [ Ho giocato — Reset ]
          </button>
        </div>
      </Section>
    </div>
  );
};

// ─── BRAINSTORM ───────────────────────────────────────────────────────────────
const BrainstormView = ({ideas, setIdeas, anthropicKey, onNeedKey}) => {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [taskClientId, setTaskClientId] = useState("");
  const [filter, setFilter] = useState("all");
  const cats = ["all",...[...new Set(ideas.map(i=>i.category).filter(Boolean))]];

  const submit = async () => {
    if(!input.trim())return;
    if(!anthropicKey){onNeedKey();return;}
    setLoading(true);
    const raw = input.trim(); setInput("");
    try {
      const res = await fetch("https://apify-worker.luciettiandrea.workers.dev/anthropic/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":anthropicKey},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:400,messages:[{role:"user",content:`Sei l'AI di Studio Brillo (freelance web design, Vicenza). L'utente scrive:\n"${raw}"\nRispondi SOLO con JSON:\n{"refined":"idea chiarita in 1-2 frasi","category":"Marketing|Prodotto|Lead Gen|Workflow|Contenuti|Business|Tech","tags":["a","b"],"score":5,"action":"azione concreta da fare ora"}`}]})});
      const d = await res.json();
      const p = JSON.parse((d.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim());
      const nid2={id:uid(),raw,refined:p.refined||raw,category:p.category||'Altro',tags:p.tags||[],score:p.score||5,action:p.action||'',created_at:todayStr()};setIdeas(prev=>[nid2,...prev]);pushItem('ideas',nid2);
    } catch { setIdeas(prev=>[{id:uid(),raw,refined:raw,category:"Altro",tags:[],score:5,action:"",createdAt:todayStr()},...prev]); }
    finally { setLoading(false); }
  };

  const sorted = [...(filter==="all"?ideas:ideas.filter(i=>i.category===filter))].sort((a,b)=>b.score-a.score);

  return (
    <div className="fi">
      <Section title="Idea Vault">
        <Card glow style={{marginBottom:14}}>
          <Label>Lancia un'idea — The System la raffina</Label>
          <Textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))submit();}} placeholder="Qualsiasi cosa: idea, problema, intuizione..." style={{minHeight:70}}/>
          <Btn style={{width:"100%",justifyContent:"center",opacity:loading?.6:1}} onClick={submit} disabled={loading}>
            {loading?"[ processing... ]":"[ PROCESS — ⌘+Enter ]"}
          </Btn>
        </Card>
        {ideas.length>0 && (
          <Row gap={5} style={{marginBottom:12,flexWrap:"wrap"}}>
            {cats.map(c=>(
              <button key={c} onClick={()=>setFilter(c)} style={{background:filter===c?C.accentDim:"transparent",border:`1px solid ${filter===c?C.accent:C.border}`,borderRadius:4,color:filter===c?C.accent:C.textDim,padding:"4px 9px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:15,letterSpacing:"0.1em",textTransform:"uppercase"}}>
                {c}
              </button>
            ))}
          </Row>
        )}
        {sorted.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,padding:"16px 0",textAlign:"center"}}>// Vault empty.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {sorted.map(idea=>(
            <Card key={idea.id}>
              <Row style={{justifyContent:"space-between",marginBottom:8}}>
                <Row gap={8}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize:18,fontWeight:700,color:idea.score>=8?C.gold:idea.score>=6?C.accent:C.textDim,lineHeight:1}}>{idea.score}</div>
                  <Chip color={C.accent}>{idea.category}</Chip>
                </Row>
                <button onClick={()=>{setIdeas(prev=>prev.filter(x=>x.id!==idea.id));deleteItem('ideas',idea.id);}} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:16,padding:"0 2px"}}>×</button>
              </Row>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.text,marginBottom:8,lineHeight:1.6}}>{idea.refined}</div>
              {idea.action && (
                <div style={{background:C.accentDim,border:`1px solid ${C.borderHi}`,borderRadius:4,padding:"6px 10px",marginBottom:8}}>
                  <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:C.accent,letterSpacing:"0.1em",textTransform:"uppercase"}}>ACTION → </span>
                  <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.text}}>{idea.action}</span>
                </div>
              )}
              <Row gap={5} style={{flexWrap:"wrap",alignItems:"center"}}>
                {idea.tags.map(t=><Chip key={t} color={C.textMuted}>#{t}</Chip>)}
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,marginLeft:"auto"}}>{idea.createdAt}</span>
              </Row>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
};

// ─── AGENT ────────────────────────────────────────────────────────────────────
const AgentView = ({clients,leads,quests,tasks=[],ideas,workoutLog,dietLog,moodLog,anthropicKey,onNeedKey}) => {
  const [msgs, setMsgs] = useState([{role:"sys",content:"System online. Ho accesso a tutti i tuoi dati live. Cosa vuoi sapere, Player?"}]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [taskClientId, setTaskClientId] = useState("");
  const endRef = useRef(null);
  useEffect(()=>endRef.current?.scrollIntoView({behavior:"smooth"}),[msgs]);

  const send = async () => {
    if(!input.trim()||loading)return;
    if(!anthropicKey){onNeedKey();return;}
    const txt = input.trim(); setInput("");
    const next = [...msgs,{role:"user",content:txt}];
    setMsgs(next); setLoading(true);
    const xp = getXP(clients,leads,quests,tasks||[]);
    const today = todayStr();
    const ctx = `Sei The System — AI di Andrea (il Player), freelance web design a Vicenza con Studio Brillo.
RANK: ${getRank(xp).r} — ${xp} XP
CLIENTI: ${clients.map(c=>`${c.name}[${c.stage}${c.income?",€"+c.income:""}]`).join(",")||"nessuno"}
PIPELINE: ${leads.map(l=>`${l.name}[${l.stage}]`).join(",")||"vuota"}
QUEST: ${quests.filter(q=>q.done).length}/${quests.length} — aperte: ${quests.filter(q=>!q.done).map(q=>q.text).join(",")||"nessuna"}
OGGI: workout=${workoutLog[today]?.done?"sì":"no"} | dieta=${dietLog[today]?.ok===true?"ok":dietLog[today]?.ok===false?"sgarro":"N/D"} | umore=${moodLog[today]?.emoji||"N/D"}
IDEAS: ${ideas.slice(0,3).map(i=>`"${(i.refined||"").slice(0,40)}"[${i.score}/10]`).join(",")||"vuoto"}
Tono: diretto, da mentore, italiano. Conciso e utile.`;
    try {
      const apiMsgs = next.filter(m=>m.role!=="sys").map(m=>({role:m.role,content:m.content}));
      const res = await fetch("https://apify-worker.luciettiandrea.workers.dev/anthropic/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":anthropicKey},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:600,system:ctx,messages:apiMsgs})});
      const d = await res.json();
      setMsgs(p=>[...p,{role:"assistant",content:d.content?.[0]?.text||"Errore."}]);
    } catch { setMsgs(p=>[...p,{role:"assistant",content:"Errore connessione."}]); }
    finally { setLoading(false); }
  };

  return (
    <div className="fi" style={{display:"flex",flexDirection:"column",height:"calc(100dvh - 200px)",minHeight:380}}>
      <div style={{fontFamily:"'Cinzel',serif",fontSize:16,color:C.accent,letterSpacing:"0.15em",marginBottom:12}}>THE SYSTEM — AI AGENT</div>
      <div style={{flex:1,overflow:"auto",display:"flex",flexDirection:"column",gap:8,paddingBottom:8}}>
        {msgs.map((m,i)=>(
          <Row key={i} style={{justifyContent:m.role==="user"?"flex-end":"flex-start",alignItems:"flex-end"}}>
            <div style={{maxWidth:"88%",padding:"10px 14px",borderRadius:8,background:m.role==="user"?C.accentDim:C.panel,border:`1px solid ${m.role==="user"?C.accent:C.border}`,fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:C.text,lineHeight:1.65}}>
              {m.role!=="user" && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.accent,marginBottom:5,letterSpacing:"0.12em"}}>THE SYSTEM://</div>}
              <div style={{whiteSpace:"pre-wrap"}}>{m.content}</div>
            </div>
          </Row>
        ))}
        {loading && <div style={{display:"flex"}}><div style={{padding:"10px 14px",borderRadius:8,background:C.panel,border:`1px solid ${C.border}`,fontFamily:"'Share Tech Mono',monospace",fontSize:"clamp(9px,0.9vw,13px)",color:C.textDim}} className="blink">processing</div></div>}
        <div ref={endRef}/>
      </div>
      <Row gap={7} style={{paddingTop:10,borderTop:`1px solid ${C.border}`}}>
        <Input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Chiedimi qualcosa..." style={{marginBottom:0,flex:1}}/>
        <Btn onClick={send} disabled={loading} style={{flexShrink:0,padding:"9px 14px"}}>→</Btn>
      </Row>
    </div>
  );
};

// ─── HUNTER ──────────────────────────────────────────────────────────────────
const HunterView = ({onAddToLeads, apiKeys, onNeedKey}) => {
  const [zona, setZona] = useState("Vicenza");
  const [settore, setSettore] = useState("Ristorazione");
  const [qty, setQty] = useState(10);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [taskClientId, setTaskClientId] = useState("");
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const hunt = async () => {
    if(!apiKeys.apify){onNeedKey();return;}
    setLoading(true);setError("");setResults([]);
    try {
      setStep("Avvio scraping...");
      const PROXY = "https://apify-worker.luciettiandrea.workers.dev/proxy";
      const r1 = await fetch(`${PROXY}/v2/acts/compass~crawler-google-places/runs?token=${apiKeys.apify}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({searchStringsArray:[`${settore} ${zona} Italia`],maxCrawledPlacesPerSearch:qty,language:"it",countryCode:"it"})});
      if(!r1.ok)throw new Error(`Apify ${r1.status}`);
      const {data:{id:runId}} = await r1.json();
      let ok=false,att=0;
      while(!ok&&att<35){
        await new Promise(r=>setTimeout(r,5000));
        const s=await(await fetch(`${PROXY}/v2/actor-runs/${runId}?token=${apiKeys.apify}`)).json();
        setStep(`${s.data?.status} (${att*5}s)`);
        if(s.data?.status==="SUCCEEDED")ok=true;
        else if(["FAILED","ABORTED","TIMED-OUT"].includes(s.data?.status))throw new Error(`Run ${s.data?.status}`);
        att++;
      }
      if(!ok)throw new Error("Timeout");
      const items=await(await fetch(`${PROXY}/v2/actor-runs/${runId}/dataset/items?token=${apiKeys.apify}&limit=${qty}`)).json();
      setResults((Array.isArray(items)?items:[]).map(i=>({id:uid(),name:i.title||"N/D",address:i.address||"",phone:i.phone||"",website:i.website||"",rating:i.totalScore||null,reviewsCount:i.reviewsCount||0,category:i.categoryName||settore,generatedEmail:null,added:false})));
    } catch(e){setError(e.message);}
    finally{setLoading(false);setStep("");}
  };

  return (
    <div className="fi">
      <Section title="Lead Hunter">
        <Card glow style={{marginBottom:14}}>
          <Grid cols={2} gap={8}>
            <div><Label>Zona</Label><Input value={zona} onChange={e=>setZona(e.target.value)} placeholder="Vicenza, Bassano..."/></div>
            <div><Label>Settore</Label>
              <Input value={settore} onChange={e=>setSettore(e.target.value)} placeholder="Es. Ristorazione, Retail..." style={{marginBottom:0}}/>
            </div>
          </Grid>
          <div style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
              <Label>Numero risultati</Label>
              <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.accent,fontWeight:700}}>{qty}</span>
            </div>
            <input type="range" min={5} max={50} step={5} value={qty} onChange={e=>setQty(Number(e.target.value))}
              style={{width:"100%",accentColor:C.accent,cursor:"pointer"}}/>
            <div style={{display:"flex",justifyContent:"space-between",fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,marginTop:3}}>
              <span>5</span><span>50</span>
            </div>
          </div>
          <Btn style={{width:"100%",justifyContent:"center",padding:"11px",opacity:loading?.6:1}} onClick={hunt} disabled={loading}>
            {loading?`[ ${step||"..."} ]`:`[ 🎯 CERCA ${qty} AZIENDE ]`}
          </Btn>
          {loading && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textMuted,textAlign:"center",marginTop:7}}>// Apify Google Maps — attendere 30-90s</div>}
        </Card>
        {error && <Card style={{borderColor:C.danger+"55",marginBottom:10}}><div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.danger}}>{error}</div></Card>}
        {results.length>0 && (
          <>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:"clamp(9px,0.9vw,13px)",color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>{results.length} aziende trovate</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {results.map(r=>(
                <Card key={r.id} style={{borderColor:r.added?C.success+"55":C.border}}>
                  <Row style={{justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,color:C.text,fontSize:16,marginBottom:4}}>{r.name}</div>
                      <Chip color={C.textDim}>{r.category}</Chip>
                    </div>
                    {r.rating && <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                      <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.gold}}>⭐ {r.rating}</div>
                      <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted}}>{r.reviewsCount} rec.</div>
                    </div>}
                  </Row>
                  {/* Website sempre in evidenza */}
                  {r.website
                    ? <a href={r.website} target="_blank" rel="noopener noreferrer" style={{display:"block",fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.accent,marginBottom:6,wordBreak:"break-all",textDecoration:"none",padding:"6px 10px",background:C.accentDim,borderRadius:4,border:`1px solid ${C.borderHi}`}}>
                        🌐 {r.website}
                      </a>
                    : <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.danger,marginBottom:6,padding:"5px 10px",background:`${C.danger}08`,borderRadius:4}}>⚠ Nessun sito web — ottimo target</div>
                  }
                  {r.address && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textDim,marginBottom:2}}>📍 {r.address}</div>}
                  {r.phone && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textDim,marginBottom:8}}>📞 {r.phone}</div>}
                  <Row gap={7}>
                    {!r.added
                      ? <Btn variant="ghost" size="sm" style={{flex:1,justifyContent:"center"}} onClick={()=>{onAddToLeads({id:uid(),name:r.name,contact:r.phone||r.website||"",sector:r.category,stage:"Da contattare",source:"Lead Hunter",website:r.website||"",notes:r.address,createdAt:todayStr()});setResults(p=>p.map(x=>x.id===r.id?{...x,added:true}:x));}}>+ Pipeline</Btn>
                      : <span style={{flex:1,fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.success,padding:"6px"}}>✓ in pipeline</span>
                    }

                  </Row>

                </Card>
              ))}
            </div>
          </>
        )}
      </Section>
    </div>
  );
};

// ─── WEIGHT ──────────────────────────────────────────────────────────────────

const WeightView = ({weightLog, setWeightLog}) => {
  const [val, setVal] = useState("");
  const [note, setNote] = useState("");
  const entries = [...weightLog].sort((a,b)=>b.date.localeCompare(a.date));
  const add = () => {
    if(!val) return;
    setWeightLog(prev=>[...prev,{id:uid(),date:todayStr(),weight:parseFloat(val),note}]);
    setVal(""); setNote("");
  };
  const last = entries[0];
  const prev = entries[1];
  const diff = last&&prev ? (last.weight-prev.weight).toFixed(1) : null;
  const min7 = entries.slice(0,7);
  const maxW = Math.max(...min7.map(e=>e.weight),0);
  const minW = Math.min(...min7.map(e=>e.weight),999);
  const range = maxW-minW||1;

  return (
    <div className="fi">
      <Section title="Peso Corporeo">
        {last && (
          <Card glow style={{marginBottom:14,textAlign:"center",padding:"20px 16px"}}>
            <Label>Ultimo rilevato — {last.date}</Label>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:52,fontWeight:900,color:C.accent,lineHeight:1}} className="rp">{last.weight}<span style={{fontSize:16,color:C.textDim}}> kg</span></div>
            {diff!==null && (
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:parseFloat(diff)<0?C.success:parseFloat(diff)>0?C.danger:C.textDim,marginTop:6}}>
                {parseFloat(diff)>0?"+":""}{diff} kg rispetto alla misurazione precedente
              </div>
            )}
          </Card>
        )}
        <Card glow={false} style={{marginBottom:14}}>
          <Label>Aggiungi misurazione</Label>
          <Grid cols={2} gap={8}>
            <div><Label>Peso (kg)</Label><Input type="number" step="0.1" value={val} onChange={e=>setVal(e.target.value)} placeholder="Es. 78.5" onKeyDown={e=>e.key==="Enter"&&add()}/></div>
            <div><Label>Nota (opz.)</Label><Input value={note} onChange={e=>setNote(e.target.value)} placeholder="Es. mattina a digiuno"/></div>
          </Grid>
          <Btn style={{width:"100%",justifyContent:"center"}} onClick={add}>[ SALVA ]</Btn>
        </Card>
        {min7.length>1 && (
          <Card style={{marginBottom:14}}>
            <Label>Andamento (ultime {min7.length} misurazioni)</Label>
            <div style={{display:"flex",alignItems:"flex-end",gap:4,height:60,marginTop:10}}>
              {[...min7].reverse().map(e=>{
                const h = Math.max(Math.round(((e.weight-minW)/range)*50)+10,10);
                return (
                  <div key={e.id} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:6,color:C.textDim}}>{e.weight}</div>
                    <div style={{width:"100%",height:h,background:C.accent,borderRadius:"3px 3px 0 0",opacity:.8}}/>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:6,color:C.textMuted}}>{e.date.slice(5)}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
        {entries.length>0 && (
          <Card>
            <Label>Storico</Label>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:8}}>
              {entries.slice(0,10).map(e=>(
                <Row key={e.id} style={{justifyContent:"space-between"}}>
                  <div>
                    <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.text}}>{e.weight} kg</span>
                    {e.note && <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textDim,marginLeft:8}}>{e.note}</span>}
                  </div>
                  <Row gap={8}>
                    <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textMuted}}>{e.date}</span>
                    <button onClick={()=>setWeightLog(prev=>prev.filter(x=>x.id!==e.id))} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:13}}>×</button>
                  </Row>
                </Row>
              ))}
            </div>
          </Card>
        )}
      </Section>
    </div>
  );
};

// ─── HABITS ───────────────────────────────────────────────────────────────────
const HabitsView = ({habits, setHabits, habitLog, setHabitLog}) => {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({name:"",icon:"⭐",target:1,unit:"volta"});
  const today = todayStr();
  const ICONS = ["⭐","📚","🧘","🏃","💧","🎨","🎸","✍️","🛌","🥤","🌿","🔥"];

  const addHabit = () => {
    if(!form.name.trim()) return;
    setHabits(prev=>[...prev,{id:uid(),...form,createdAt:today}]);
    setForm({name:"",icon:"⭐",target:1,unit:"volta"});
    setModal(false);
  };

  const logHabit = (habitId) => {
    const key = `${habitId}-${today}`;
    const curr = habitLog[key]||0;
    const habit = habits.find(h=>h.id===habitId);
    const next = curr+1 > (habit?.target||1) ? 0 : curr+1;
    setHabitLog(prev=>({...prev,[key]:next}));
  };

  const getStreak = (habitId) => {
    let s=0, d=new Date();
    while(s<365) {
      const k = `${habitId}-${d.toISOString().slice(0,10)}`;
      const habit = habits.find(h=>h.id===habitId);
      if((habitLog[k]||0) >= (habit?.target||1)) { s++; d.setDate(d.getDate()-1); } else break;
    }
    return s;
  };

  const last7 = Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-i);return d.toISOString().slice(0,10);}).reverse();

  return (
    <div className="fi">
      <Section title="Abitudini" action={<Btn size="sm" onClick={()=>setModal(true)}>+ Nuova</Btn>}>
        {habits.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,padding:"20px 0",textAlign:"center"}}>// Nessuna abitudine. Aggiungine una.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {habits.map(h=>{
            const todayVal = habitLog[`${h.id}-${today}`]||0;
            const done = todayVal >= (h.target||1);
            const streak = getStreak(h.id);
            const last30 = Array.from({length:30},(_,i)=>{const d=new Date();d.setDate(d.getDate()-i);return d.toISOString().slice(0,10);}).reverse();
            const completedDays30 = last30.filter(d=>(habitLog[`${h.id}-${d}`]||0)>=(h.target||1)).length;
            const pct30 = Math.round(completedDays30/30*100);
            const thisWeek = last7.filter(d=>(habitLog[`${h.id}-${d}`]||0)>=(h.target||1)).length;
            return (
                  <Card key={h.id} style={{borderColor:done?C.success+"55":C.border}}>
                    <Row style={{justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                      <Row gap={10}>
                        <span style={{fontSize:22}}>{h.icon}</span>
                        <div>
                          <div style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,color:done?C.success:C.text,fontSize:16}}>{h.name}</div>
                          <Row gap={10} style={{marginTop:3}}>
                            <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.orange}}>🔥 {streak}d</span>
                            <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.textDim}}>{thisWeek}/7 sett.</span>
                            <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:pct30>=70?C.success:pct30>=40?C.gold:C.danger}}>{pct30}% mese</span>
                          </Row>
                        </div>
                      </Row>
                      <Row gap={8}>
                        <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:done?C.success:C.textDim}}>{todayVal}/{h.target}</div>
                        <button onClick={()=>setHabits(prev=>prev.filter(x=>x.id!==h.id))} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:16}}>×</button>
                      </Row>
                    </Row>
                    <button onClick={()=>logHabit(h.id)} style={{width:"100%",background:done?C.successDim:C.bg,border:`2px solid ${done?C.success:C.border}`,borderRadius:6,color:done?C.success:C.textDim,padding:"10px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:15,letterSpacing:"0.08em",textTransform:"uppercase",transition:"all .2s",marginBottom:10}}>
                      {done ? "✓ Fatto oggi" : `Segna (+1)`}
                    </button>
                    {/* 30-day chart */}
                    <div style={{marginBottom:8}}>
                      <div style={{display:"flex",gap:2,height:28,alignItems:"flex-end"}}>
                        {last30.map(d=>{
                          const v = habitLog[`${h.id}-${d}`]||0;
                          const ok = v>=(h.target||1);
                          const partial = v>0&&!ok;
                          return <div key={d} style={{flex:1,borderRadius:2,background:ok?C.success:partial?C.gold:C.bg,border:`1px solid ${ok?C.success:partial?C.gold:C.border}`,height:ok?"100%":partial?"60%":"30%",transition:"height .2s"}}/>;
                        })}
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textMuted,marginTop:4}}>
                        <span>30 giorni fa</span><span>oggi</span>
                      </div>
                    </div>
                    {/* Last 7 days detail */}
                    <div style={{display:"flex",gap:4,justifyContent:"space-between"}}>
                      {last7.map(d=>{
                        const v = habitLog[`${h.id}-${d}`]||0;
                        const ok = v>=(h.target||1);
                        const dayShort = new Date(d).toLocaleDateString("it-IT",{weekday:"short"});
                        return (
                          <div key={d} style={{flex:1,textAlign:"center"}}>
                            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textMuted,marginBottom:3}}>{dayShort}</div>
                            <div style={{aspectRatio:"1",borderRadius:4,background:ok?C.successDim:C.bg,border:`1px solid ${ok?C.success:C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:ok?C.success:C.textMuted}}>
                              {ok?"✓":""}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
            );
          })}
        </div>
      </Section>
      {modal && (
        <Modal title="Nuova Abitudine" onClose={()=>setModal(false)}>
          <Label>Nome</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Es. Lettura, Meditazione..."/>
          <Label>Icona</Label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
            {ICONS.map(i=>(
              <button key={i} onClick={()=>setForm({...form,icon:i})} style={{background:form.icon===i?C.borderHi:"transparent",border:`1px solid ${form.icon===i?C.borderHi:C.border}`,borderRadius:5,padding:"6px 8px",cursor:"pointer",fontSize:18,lineHeight:1}}>{i}</button>
            ))}
          </div>
          <Grid cols={2} gap={8}>
            <div><Label>Target giornaliero</Label><Input type="number" value={form.target} onChange={e=>setForm({...form,target:parseInt(e.target.value)||1})} placeholder="1"/></div>
            <div><Label>Unità</Label><Input value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} placeholder="volta, km, min..."/></div>
          </Grid>
          <Row gap={8} style={{marginTop:4}}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setModal(false)}>Annulla</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={addHabit}>[ AGGIUNGI ]</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
};

// ─── TASK + NOTE (merged) ─────────────────────────────────────────────────────
// ─── PROJECTS VIEW ───────────────────────────────────────────────────────────
const ProjectsView = ({projects, setProjects}) => {
  const [modal, setModal] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#4fc3f7");
  const [expanded, setExpanded] = useState(null);
  const [newTask, setNewTask] = useState({});

  const COLORS = ["#4fc3f7","#dfff00","#4caf50","#f44336","#ff9800","#ce93d8","#80cbc4","#fff"];

  const saveProjects = (np) => { setProjects(np); DB.setSetting("projects", np); };

  const addProject = () => {
    if(!name.trim()) return;
    saveProjects([...projects, {id:uid(), name:name.trim(), color, tasks:[], createdAt:todayStr()}]);
    setName(""); setColor("#4fc3f7"); setModal(false);
  };

  const addTask = (pid) => {
    const txt = (newTask[pid]||"").trim();
    if(!txt) return;
    saveProjects(projects.map(p=>p.id===pid?{...p,tasks:[...(p.tasks||[]),{id:uid(),text:txt,done:false}]}:p));
    setNewTask(prev=>({...prev,[pid]:""}));
  };

  const toggleTask = (pid, tid) => {
    saveProjects(projects.map(p=>p.id===pid?{...p,tasks:(p.tasks||[]).map(t=>t.id===tid?{...t,done:!t.done}:t)}:p));
  };

  const deleteTask = (pid, tid) => {
    saveProjects(projects.map(p=>p.id===pid?{...p,tasks:(p.tasks||[]).filter(t=>t.id!==tid)}:p));
  };

  const getPct = (p) => p.progress||0;

  return (
    <div>
      <Row style={{justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:16,color:C.accent,letterSpacing:"0.12em",textTransform:"uppercase"}}>Progetti</div>
        <Btn size="sm" onClick={()=>setModal(true)}>+ Nuovo</Btn>
      </Row>

      {projects.length===0 && (
        <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.textMuted,padding:"20px 0",textAlign:"center"}}>// Nessun progetto. Creane uno.</div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {projects.map(p=>{
          const pct = getPct(p);
          const tasks = p.tasks||[];
          const isOpen = expanded===p.id;
          return (
            <Card key={p.id} style={{borderColor:pct===100?C.success+"55":p.color+"44"}}>
              <Row style={{justifyContent:"space-between",marginBottom:8}}>
                <Row gap={10} style={{flex:1,cursor:"pointer",minWidth:0}} onClick={()=>setExpanded(isOpen?null:p.id)}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:p.color,flexShrink:0,marginTop:3}}/>
                  <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:17,color:pct===100?C.success:C.text}}>{p.name}</span>
                </Row>
                <Row gap={8} style={{flexShrink:0}}>
                  <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:pct===100?C.success:p.color}}>{tasks.filter(t=>t.done).length}/{tasks.length}</span>
                  <span style={{fontFamily:"'Cinzel',serif",fontSize:15,fontWeight:700,color:pct===100?C.success:p.color}}>{pct}%</span>
                  <button onClick={()=>setExpanded(isOpen?null:p.id)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:4,color:C.textDim,cursor:"pointer",fontSize:13,padding:"2px 8px"}}>{isOpen?"▲":"▼"}</button>
                  <button onClick={()=>saveProjects(projects.filter(x=>x.id!==p.id))} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:15}}>×</button>
                </Row>
              </Row>

              <div style={{height:5,background:C.border,borderRadius:3,marginBottom:isOpen?14:0,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${pct}%`,background:pct===100?C.success:p.color,borderRadius:3,transition:"width .3s"}}/>
              </div>

              {isOpen && (
                <div style={{marginTop:4}}>
                  {/* Manual progress slider */}
                  <div style={{marginBottom:14,padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
                    <Row style={{justifyContent:"space-between",marginBottom:6}}>
                      <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:13,color:C.textDim,letterSpacing:"0.08em",textTransform:"uppercase"}}>Avanzamento</span>
                      <span style={{fontFamily:"'Cinzel',serif",fontSize:15,fontWeight:700,color:pct===100?C.success:p.color}}>{pct}%</span>
                    </Row>
                    <input type="range" min={0} max={100} step={5}
                      value={pct}
                      onChange={e=>saveProjects(projects.map(x=>x.id===p.id?{...x,progress:parseInt(e.target.value)}:x))}
                      style={{width:"100%",accentColor:pct===100?C.success:p.color,cursor:"pointer",height:6}}/>
                  </div>
                  {tasks.length===0 && (
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.textMuted,padding:"8px 0",textAlign:"center"}}>// Nessuna task. Aggiungine una.</div>
                  )}
                  {tasks.map(t=>(
                    <Row key={t.id} gap={10} style={{padding:"8px 4px",borderBottom:`1px solid ${C.border}`,alignItems:"center"}}>
                      <button onClick={()=>toggleTask(p.id,t.id)} style={{width:20,height:20,borderRadius:4,border:`2px solid ${t.done?p.color:C.border}`,background:t.done?p.color:"transparent",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                        {t.done && <span style={{color:"#000",fontSize:12,fontWeight:900}}>✓</span>}
                      </button>
                      <span style={{flex:1,fontFamily:"'Share Tech Mono',monospace",fontSize:14,color:t.done?C.textMuted:C.text,textDecoration:t.done?"line-through":"none",lineHeight:1.4}}>{t.text}</span>
                      <button onClick={()=>deleteTask(p.id,t.id)} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:14,flexShrink:0}}>×</button>
                    </Row>
                  ))}
                  <Row gap={8} style={{marginTop:10}}>
                    <Input value={newTask[p.id]||""} onChange={e=>setNewTask(prev=>({...prev,[p.id]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addTask(p.id)} placeholder="Nuova task..." style={{marginBottom:0,flex:1,fontSize:13}}/>
                    <Btn size="sm" onClick={()=>addTask(p.id)} style={{flexShrink:0}}>+</Btn>
                  </Row>
                </div>
              )}

              {pct===100 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.success,marginTop:8,textAlign:"center"}}>✓ COMPLETATO</div>}
            </Card>
          );
        })}
      </div>

      {modal && (
        <Modal title="Nuovo Progetto" onClose={()=>setModal(false)}>
          <Label>Nome progetto</Label>
          <Input value={name} onChange={e=>setName(e.target.value)} placeholder="Es. Sito Vitamin Store, Brand CLG..." onKeyDown={e=>e.key==="Enter"&&addProject()}/>
          <Label>Colore</Label>
          <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
            {COLORS.map(c=>(
              <button key={c} onClick={()=>setColor(c)} style={{width:32,height:32,borderRadius:"50%",background:c,border:`3px solid ${color===c?"#fff":"transparent"}`,cursor:"pointer",flexShrink:0}}/>
            ))}
          </div>
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setModal(false)}>Annulla</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={addProject}>[ CREA ]</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
};


const TaskNotesView = ({tasks,setTasks,notes,setNotes,projects,setProjects,anthropicKey,onNeedKey,clients=[]}) => {
  const [subtab, setSubtab] = useState("tasks");
  return (
    <div className="fi">
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[["tasks","Task"],["projects","Progetti"],["notes","Note"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubtab(k)} style={{flex:1,background:subtab===k?C.accentDim:"transparent",border:`1px solid ${subtab===k?C.accent:C.border}`,borderRadius:5,color:subtab===k?C.accent:C.textDim,padding:"8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:14,letterSpacing:"0.08em",textTransform:"uppercase",transition:"all .2s"}}>
            {l}
          </button>
        ))}
      </div>
      {subtab==="tasks" && <TasksView tasks={tasks} setTasks={setTasks} anthropicKey={anthropicKey} onNeedKey={onNeedKey} clients={clients}/>}
      {subtab==="projects" && <ProjectsView projects={projects||[]} setProjects={setProjects}/>}
      {subtab==="notes" && <NotesView notes={notes} setNotes={setNotes}/>}
    </div>
  );
};

// ─── SALUTE (workout + diet + weight merged) ───────────────────────────────────
const SaluteView = ({workoutLog,setWorkoutLog,dietLog,setDietLog,weightLog,setWeightLog}) => {
  const [subtab, setSubtab] = useState("workout");
  return (
    <div className="fi">
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[["workout","Workout"],["diet","Dieta"],["weight","Peso"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubtab(k)} style={{flex:1,background:subtab===k?C.accentDim:"transparent",border:`1px solid ${subtab===k?C.accent:C.border}`,borderRadius:5,color:subtab===k?C.accent:C.textDim,padding:"8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:16,letterSpacing:"0.08em",textTransform:"uppercase",transition:"all .2s"}}>
            {l}
          </button>
        ))}
      </div>
      {subtab==="workout" && <WorkoutView workoutLog={workoutLog} setWorkoutLog={setWorkoutLog}/>}
      {subtab==="diet" && <DietView dietLog={dietLog} setDietLog={setDietLog}/>}
      {subtab==="weight" && <WeightView weightLog={weightLog} setWeightLog={setWeightLog}/>}
    </div>
  );
};

// ─── CHECK-IN (mood + habits merged) ──────────────────────────────────────────
const CheckinView = ({moodLog,setMoodLog,habits,setHabits,habitLog,setHabitLog,slotDays,setSlotDays,setSlotStart,smokeLog={},setSmokeLog=()=>{},focusLog:focusLogProp={},setFocusLog:setFocusLogProp=()=>{}}) => {
  const [subtab, setSubtab] = useState("mood");
  const today = todayStr();

  // Focus streak state
  const focusLog = focusLogProp;
  const setFocusLog = setFocusLogProp;
  const todayFocus = focusLog[today]??null;

  const handleFocus = (val) => {
    if(focusLog[today]===val) return;
    const newLog = {...focusLog,[today]:val};
    localStorage.setItem("ts_focus_log", JSON.stringify(newLog));
    setFocusLog(newLog);
    if(val===false){ setSlotDays(0); setSlotStart(today); }
    else if(val===true){ setSlotDays(s=>s+1); }
  };

  const streak = (() => {
    let s=0; const d=new Date();
    for(let i=0;i<365;i++){
      const k=d.toISOString().slice(0,10);
      if(focusLog[k]===true){s++;d.setDate(d.getDate()-1);}
      else break;
    }
    return s;
  })();

  const last14focus = Array.from({length:14},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(13-i));
    const k=d.toISOString().slice(0,10);
    return {k, short:d.toLocaleDateString("it-IT",{weekday:"short"}), val:focusLog[k]??null};
  });

  // Smoke counter state
  const todaySmoke = smokeLog[today]||0;

  const updateSmoke = (n) => { setSmokeLog(s=>({...s,[today]:Math.max(0,n)})); };

  const last14smoke = Array.from({length:14},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(13-i));
    const k=d.toISOString().slice(0,10);
    return {k, short:d.toLocaleDateString("it-IT",{weekday:"short"}), n:smokeLog[k]||0};
  });
  const avg7 = last14smoke.slice(7).reduce((s,x)=>s+x.n,0)/7;
  const avg7prev = last14smoke.slice(0,7).reduce((s,x)=>s+x.n,0)/7;
  const maxSmoke = Math.max(...last14smoke.map(x=>x.n),1);

  return (
    <div className="fi">
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {[["mood","Mood"],["habits","Abitudini"],["focus","Streak"],["smoke","🚬"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubtab(k)} style={{flex:1,minWidth:"22%",background:subtab===k?C.accentDim:"transparent",border:`1px solid ${subtab===k?C.accent:C.border}`,borderRadius:5,color:subtab===k?C.accent:C.textDim,padding:"8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:13,letterSpacing:"0.08em",textTransform:"uppercase",transition:"all .2s"}}>
            {l}
          </button>
        ))}
      </div>

      {subtab==="mood" && <MoodView moodLog={moodLog} setMoodLog={setMoodLog}/>}
      {subtab==="habits" && <HabitsView habits={habits} setHabits={setHabits} habitLog={habitLog} setHabitLog={setHabitLog}/>}

      {subtab==="focus" && (
        <div>
          <Card glow color={streak>7?C.success:streak>3?C.gold:C.accent} style={{marginBottom:14,textAlign:"center",padding:"24px 16px"}}>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.textDim,letterSpacing:"0.2em",marginBottom:8}}>STREAK</div>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:72,fontWeight:900,color:streak>7?C.success:streak>3?C.gold:C.accent,lineHeight:1}} className="rp">{streak}</div>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.textDim,marginTop:8}}>giorni</div>
          </Card>
          <Card style={{marginBottom:14}}>
            <Label>Oggi — intrusive thoughts?</Label>
            <Grid cols={2} gap={8} style={{marginTop:8}}>
              <button onClick={()=>handleFocus(true)} style={{background:todayFocus===true?C.successDim:"transparent",border:`2px solid ${todayFocus===true?C.success:C.border}`,borderRadius:7,color:todayFocus===true?C.success:C.textDim,padding:"14px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:14,textTransform:"uppercase",transition:"all .2s",textAlign:"center"}}>
                <div style={{fontSize:26,marginBottom:4}}>✅</div>NO
              </button>
              <button onClick={()=>handleFocus(false)} style={{background:todayFocus===false?C.dangerDim:"transparent",border:`2px solid ${todayFocus===false?C.danger:C.border}`,borderRadius:7,color:todayFocus===false?C.danger:C.textDim,padding:"14px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:14,textTransform:"uppercase",transition:"all .2s",textAlign:"center"}}>
                <div style={{fontSize:26,marginBottom:4}}>❌</div>SÌ
              </button>
            </Grid>
            {todayFocus===false && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.danger,marginTop:10,textAlign:"center"}}>// streak azzerata. domani si ricomincia.</div>}
            {todayFocus===true && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.success,marginTop:10,textAlign:"center"}}>// +1 giorno. tieni duro.</div>}
          </Card>
          <Card>
            <Label>Ultimi 14 giorni</Label>
            <div style={{display:"flex",gap:4,marginTop:10}}>
              {last14focus.map(({k,short,val})=>(
                <div key={k} style={{flex:1,textAlign:"center"}}>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:C.textMuted,marginBottom:4}}>{short}</div>
                  <div style={{aspectRatio:"1",borderRadius:4,background:val===true?C.successDim:val===false?C.dangerDim:C.bg,border:`1px solid ${val===true?C.success:val===false?C.danger:C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>
                    {val===true?"✓":val===false?"×":""}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {subtab==="smoke" && (
        <div>
          <Card glow style={{marginBottom:14,textAlign:"center",padding:"20px 16px"}}>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.textDim,letterSpacing:"0.15em",marginBottom:8}}>OGGI</div>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:64,fontWeight:900,color:todaySmoke>15?C.danger:todaySmoke>8?C.orange:C.gold,lineHeight:1}}>{todaySmoke}</div>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.textDim,marginTop:6}}>sigarette</div>
            <Row gap={12} style={{justifyContent:"center",marginTop:14}}>
              <button onClick={()=>updateSmoke(todaySmoke-1)} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,color:C.text,cursor:"pointer",padding:"8px 22px",fontFamily:"'Cinzel',serif",fontSize:22,fontWeight:700}}>−</button>
              <button onClick={()=>updateSmoke(todaySmoke+1)} style={{background:C.accentDim,border:`1px solid ${C.accent}`,borderRadius:6,color:C.accent,cursor:"pointer",padding:"8px 22px",fontFamily:"'Cinzel',serif",fontSize:22,fontWeight:700}}>+</button>
            </Row>
          </Card>
          <Card style={{marginBottom:14}}>
            <Row style={{justifyContent:"space-between",marginBottom:10}}>
              <div>
                <Label>Questa settimana</Label>
                <div style={{fontFamily:"'Cinzel',serif",fontSize:22,color:avg7<avg7prev?C.success:avg7>avg7prev?C.danger:C.gold,fontWeight:700}}>{avg7.toFixed(1)}<span style={{fontSize:12,color:C.textDim}}>/g</span></div>
              </div>
              <div style={{textAlign:"right"}}>
                <Label>Scorsa settimana</Label>
                <div style={{fontFamily:"'Cinzel',serif",fontSize:22,color:C.textDim,fontWeight:700}}>{avg7prev.toFixed(1)}<span style={{fontSize:12,color:C.textMuted}}>/g</span></div>
              </div>
            </Row>
            {avg7<avg7prev && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.success}}>↓ -{(avg7prev-avg7).toFixed(1)}/g rispetto alla scorsa settimana</div>}
            {avg7>avg7prev && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.danger}}>↑ +{(avg7-avg7prev).toFixed(1)}/g rispetto alla scorsa settimana</div>}
            {avg7===avg7prev && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.textDim}}>= stabile</div>}
          </Card>
          <Card>
            <Label>Ultimi 14 giorni</Label>
            <div style={{display:"flex",gap:3,alignItems:"flex-end",height:60,marginTop:10}}>
              {last14smoke.map(({k,short,n})=>(
                <div key={k} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:C.textMuted}}>{n||""}</div>
                  <div style={{width:"100%",background:n>15?C.danger:n>8?C.orange:n>0?C.gold:C.bg,border:`1px solid ${n>0?C.border:"transparent"}`,borderRadius:"2px 2px 0 0",height:`${Math.max(Math.round((n/maxSmoke)*50),n>0?4:2)}px`,transition:"height .3s"}}/>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:C.textMuted}}>{short}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

// ─── SETTINGS VIEW ────────────────────────────────────────────────────────────
const ChangePasswordCard = () => {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const submit = async () => {
    setMsg(null);
    if(pw1.length < 6){ setMsg({type:"err",text:"La password deve avere almeno 6 caratteri"}); return; }
    if(pw1 !== pw2){ setMsg({type:"err",text:"Le password non coincidono"}); return; }
    setLoading(true);
    const res = await sbAuth.changePassword(pw1);
    setLoading(false);
    if(res.ok){ setMsg({type:"ok",text:"Password cambiata con successo"}); setPw1(""); setPw2(""); }
    else setMsg({type:"err",text:res.error||"Errore"});
  };

  return (
    <Card style={{marginBottom:10,borderColor:C.borderHi}}>
      {!open ? (
        <button onClick={()=>setOpen(true)} style={{width:"100%",background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.text,padding:"12px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:15,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>
          🔑 Cambia Password
        </button>
      ) : (
        <>
          <Label>Nuova password</Label>
          <Input type="password" value={pw1} onChange={e=>setPw1(e.target.value)} placeholder="Almeno 6 caratteri"/>
          <Label>Conferma password</Label>
          <Input type="password" value={pw2} onChange={e=>setPw2(e.target.value)} placeholder="Ripeti la password" onKeyDown={e=>e.key==="Enter"&&submit()}/>
          {msg && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:msg.type==="ok"?C.success:C.danger,marginBottom:10}}>{msg.text}</div>}
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>{setOpen(false);setMsg(null);setPw1("");setPw2("");}}>Annulla</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={submit} disabled={loading}>{loading?"...":"[ SALVA ]"}</Btn>
          </Row>
        </>
      )}
    </Card>
  );
};

const SettingsView = ({quests,setQuests,clients,leads,tasks,ideas,goals,notes,payments,workoutLog,dietLog,moodLog,weightLog,habits,habitLog,slotDays,slotStart,apiKeys,keyDraft,setKeyDraft,saveKeys,onSyncNow}) => {
  return (
    <div className="fi">
      <Section title="Configurazione">
        <Card style={{marginBottom:10}}>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:C.accent,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>API Keys</div>
          <Label>Anthropic API Key</Label>
          <Input type="password" value={keyDraft.anthropic||""} onChange={e=>setKeyDraft({...keyDraft,anthropic:e.target.value})} placeholder="sk-ant-..."/>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,marginTop:-10,marginBottom:10}}>console.anthropic.com › API Keys</div>
          <Label>Apify API Key</Label>
          <Input type="password" value={keyDraft.apify||""} onChange={e=>setKeyDraft({...keyDraft,apify:e.target.value})} placeholder="apify_api_..."/>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.textMuted,marginTop:-10,marginBottom:0}}>console.apify.com › Settings › Integrations</div>
        </Card>

        <Card style={{marginBottom:10,borderColor:C.success+"33",background:`${C.success}05`}}>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:C.success,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>🗄 Supabase Sync</div>
          <Label>Project URL</Label>
          <Input value={keyDraft.sbUrl||""} onChange={e=>setKeyDraft({...keyDraft,sbUrl:e.target.value})} placeholder="https://xxxx.supabase.co"/>
          <Label>Anon Public Key</Label>
          <Input type="password" value={keyDraft.sbKey||""} onChange={e=>setKeyDraft({...keyDraft,sbKey:e.target.value})} placeholder="eyJ..."/>
        </Card>

        <Btn style={{width:"100%",justifyContent:"center",marginBottom:20}} onClick={saveKeys}>[ SALVA CONFIGURAZIONE ]</Btn>
      </Section>

      <Section title="Reset & Export">
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <Row style={{justifyContent:"space-between",alignItems:"center",background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:"12px 14px"}}>
            <div>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.text,fontWeight:600}}>Reset Quest giornaliere</div>
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textDim,marginTop:2}}>Segna tutte le quest come non fatte</div>
            </div>
            <button onClick={()=>setQuests(q=>q.map(x=>({...x,done:false})))} style={{background:"none",border:`1px solid ${C.orange}`,borderRadius:4,color:C.orange,cursor:"pointer",padding:"6px 12px",fontFamily:"'Rajdhani',sans-serif",fontSize:16,letterSpacing:"0.08em",textTransform:"uppercase",flexShrink:0}}>Reset</button>
          </Row>

          <Row style={{justifyContent:"space-between",alignItems:"center",background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:"12px 14px"}}>
            <div>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.text,fontWeight:600}}>Esporta dati (JSON)</div>
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textDim,marginTop:2}}>Backup completo di tutti i dati</div>
            </div>
            <button onClick={()=>{
              const data={clients,leads,quests,tasks,ideas,goals,notes,payments,workoutLog,dietLog,moodLog,weightLog,habits,habitLog,slotDays,slotStart,exportedAt:new Date().toISOString()};
              const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
              const url=URL.createObjectURL(blob);
              const a=document.createElement("a");
              a.href=url;a.download=`the-system-${todayStr()}.json`;a.click();
              URL.revokeObjectURL(url);
            }} style={{background:"none",border:`1px solid ${C.accent}`,borderRadius:4,color:C.accent,cursor:"pointer",padding:"6px 12px",fontFamily:"'Rajdhani',sans-serif",fontSize:16,letterSpacing:"0.08em",textTransform:"uppercase",flexShrink:0}}>Export</button>
          </Row>

          <Row style={{justifyContent:"space-between",alignItems:"center",background:`${C.danger}08`,border:`1px solid ${C.danger}33`,borderRadius:6,padding:"12px 14px"}}>
            <div>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.danger,fontWeight:600}}>Reset TUTTO</div>
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:C.textDim,marginTop:2}}>Cancella tutti i dati locali permanentemente</div>
            </div>
            <button onClick={()=>{if(!window.confirm("Sicuro? Cancella TUTTI i dati locali."))return;localStorage.clear();window.location.reload();}} style={{background:"none",border:`1px solid ${C.danger}`,borderRadius:4,color:C.danger,cursor:"pointer",padding:"6px 12px",fontFamily:"'Rajdhani',sans-serif",fontSize:16,letterSpacing:"0.08em",textTransform:"uppercase",flexShrink:0}}>RESET</button>
          </Row>
        </div>
      </Section>

      <Section title="Info">
        <Card>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {[
              ["Versione","The System v1.0"],
              ["Player","Andrea // Studio Brillo"],
              ["Clienti",clients.length],
              ["Lead",leads.length],
              ["Task totali",tasks.length],
              ["Idee in vault",ideas.length],
            ].map(([k,v])=>(
              <Row key={k} style={{justifyContent:"space-between"}}>
                <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:C.textDim}}>{k}</span>
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.text}}>{v}</span>
              </Row>
            ))}
          </div>
        </Card>
      </Section>

      <Section title="Sync">
        <Card style={{marginBottom:10}}>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.textDim,marginBottom:10}}>
            Push automatico ogni 1.5s. Pull automatico ogni 30s. Premi per forzare sync immediato.
          </div>
          <button onClick={async()=>{
            if(!getSB()){alert("Supabase non configurato");return;}
            const token = await sbAuth.getValidToken();
            if(!token){alert("Non sei loggato");return;}
            if(onSyncNow) await onSyncNow();
            alert("Sync completato!");
          }} style={{width:"100%",background:C.accentDim,border:`1px solid ${C.accent}`,borderRadius:6,color:C.accent,padding:"12px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:15,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>
            [ 🔄 SYNC ORA ]
          </button>
        </Card>
      </Section>

      <Section title="Account">
        <ChangePasswordCard/>
        <Card style={{borderColor:C.danger+"33"}}>
          <button onClick={()=>{if(window.confirm("Sei sicuro di voler uscire?")){sbAuth.signOut();window.location.reload();}}} style={{width:"100%",background:"none",border:`1px solid ${C.danger}`,borderRadius:6,color:C.danger,padding:"12px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:15,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>
            [ LOGOUT — ESCI DAL SISTEMA ]
          </button>
        </Card>
      </Section>
    </div>
  );
};

// ─── GOOGLE CALENDAR ──────────────────────────────────────────────────────────
const GCAL_CLIENT_ID = "121284875481-blaljm3eu70ja9o1mmp385nvdkpspv85.apps.googleusercontent.com";
const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar";
const GCAL_REDIRECT = "https://lemac77.github.io/thesystem";

const gcalGetToken = () => {
  try {
    const t = JSON.parse(localStorage.getItem("ts_gcal_token")||"null");
    if(!t) return null;
    if(Date.now() > t.expires_at) { localStorage.removeItem("ts_gcal_token"); return null; }
    return t.access_token;
  } catch { return null; }
};

// PKCE helpers
const gcalGenVerifier = () => {
  const arr = new Uint8Array(32);
  try { crypto.getRandomValues(arr); } catch { for(let i=0;i<32;i++) arr[i]=Math.floor(Math.random()*256); }
  return Array.from(arr).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,43);
};
const gcalGenChallenge = async (verifier) => {
  try {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  } catch {
    // Fallback: use verifier as challenge (plain method)
    return verifier;
  }
};

const gcalLogin = async () => {
  const verifier = gcalGenVerifier();
  const challenge = await gcalGenChallenge(verifier);
  localStorage.setItem("ts_gcal_verifier", verifier);
  const params = new URLSearchParams({
    client_id: GCAL_CLIENT_ID,
    redirect_uri: GCAL_REDIRECT,
    response_type: "code",
    scope: GCAL_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
};

const gcalHandleCallback = async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if(!code) return false;
  const verifier = localStorage.getItem("ts_gcal_verifier");
  if(!verifier) return false;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        code,
        client_id: GCAL_CLIENT_ID,
        redirect_uri: GCAL_REDIRECT,
        grant_type: "authorization_code",
        code_verifier: verifier,
      })
    });
    const d = await res.json();
    if(d.access_token){
      localStorage.setItem("ts_gcal_token", JSON.stringify({
        access_token: d.access_token,
        refresh_token: d.refresh_token||"",
        expires_at: Date.now() + (d.expires_in||3600)*1000
      }));
      localStorage.removeItem("ts_gcal_verifier");
      window.history.replaceState({}, "", window.location.pathname);
      return true;
    }
  } catch(e){ console.error("gcal token exchange failed:", e); }
  return false;
};

const gcalRefreshToken = async () => {
  try {
    const t = JSON.parse(localStorage.getItem("ts_gcal_token")||"null");
    if(!t?.refresh_token) return null;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        client_id: GCAL_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: t.refresh_token,
      })
    });
    const d = await res.json();
    if(d.access_token){
      localStorage.setItem("ts_gcal_token", JSON.stringify({
        ...t,
        access_token: d.access_token,
        expires_at: Date.now() + (d.expires_in||3600)*1000
      }));
      return d.access_token;
    }
  } catch(e){ console.error("gcal refresh failed:", e); }
  return null;
};

const gcalGetValidToken = async () => {
  const t = JSON.parse(localStorage.getItem("ts_gcal_token")||"null");
  if(!t) return null;
  if(Date.now() > t.expires_at - 5*60*1000){
    return await gcalRefreshToken();
  }
  return t.access_token;
};

const gcalFetchEvents = async (token, days=30) => {
  const now = new Date();
  const end = new Date(now); end.setDate(end.getDate()+days);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=50`,
    {headers: {"Authorization": `Bearer ${token}`}}
  );
  if(!res.ok) { localStorage.removeItem("ts_gcal_token"); return null; }
  const d = await res.json();
  return d.items||[];
};

const gcalCreateEvent = async (token, event) => {
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {method:"POST", headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"}, body:JSON.stringify(event)}
  );
  return res.ok;
};

const gcalDeleteEvent = async (token, eventId) => {
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {method:"DELETE", headers:{"Authorization":`Bearer ${token}`}}
  );
};

const CalendarView = () => {
  const [token, setToken] = useState(()=>gcalGetToken());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({title:"",date:todayStr(),time:"09:00",duration:60,note:""});
  const [selectedDay, setSelectedDay] = useState(todayStr);
  const [viewDate, setViewDate] = useState(()=>{const d=new Date();return {y:d.getFullYear(),m:d.getMonth()};});
  const [calView, setCalView] = useState("month"); // "month" | "week"

  useEffect(()=>{
    (async()=>{
      try {
        const handled = await gcalHandleCallback();
        if(handled){
          const tk = await gcalGetValidToken();
          setToken(tk);
        }
      } catch(e){ console.error("gcal init:", e); }
    })();
  },[]);

  useEffect(()=>{
    if(!token) return;
    (async()=>{
      setLoading(true);
      const evs = await gcalFetchEvents(token, 60);
      if(evs) setEvents(evs);
      else {
        // Token might be expired, try refresh
        const newTk = await gcalRefreshToken();
        if(newTk){ setToken(newTk); }
        else { setToken(null); }
      }
      setLoading(false);
    })();
  },[token]);

  const createEvent = async () => {
    const tk = await gcalGetValidToken();
    if(!tk||!form.title.trim()) return;
    if(tk!==token) setToken(tk);
    const start = new Date(`${form.date}T${form.time}:00`);
    const end = new Date(start.getTime()+form.duration*60000);
    const ok = await gcalCreateEvent(tk, {
      summary: form.title,
      description: form.note,
      start: {dateTime: start.toISOString(), timeZone: "Europe/Rome"},
      end: {dateTime: end.toISOString(), timeZone: "Europe/Rome"},
    });
    if(ok){
      const evs = await gcalFetchEvents(tk, 60);
      if(evs) setEvents(evs);
      setModal(false);
      setForm({title:"",date:todayStr(),time:"09:00",duration:60,note:""});
    }
  };

  const deleteEvent = async (id) => {
    const tk = await gcalGetValidToken();
    if(!tk) return;
    await gcalDeleteEvent(tk, id);
    setEvents(prev=>prev.filter(e=>e.id!==id));
  };

  // Week view helpers
  const getWeekDays = (anchor) => {
    const d = new Date(anchor+"T00:00:00");
    const day = (d.getDay()+6)%7; // Monday=0
    const monday = new Date(d); monday.setDate(d.getDate()-day);
    return Array.from({length:7},(_,i)=>{ const x=new Date(monday); x.setDate(monday.getDate()+i); return x.toISOString().slice(0,10); });
  };
  const [weekAnchor, setWeekAnchor] = useState(todayK);
  const weekDays = getWeekDays(weekAnchor);
  const prevWeek = () => { const d=new Date(weekAnchor+"T00:00:00"); d.setDate(d.getDate()-7); setWeekAnchor(d.toISOString().slice(0,10)); };
  const nextWeek = () => { const d=new Date(weekAnchor+"T00:00:00"); d.setDate(d.getDate()+7); setWeekAnchor(d.toISOString().slice(0,10)); };
  const weekLabel = `${new Date(weekDays[0]+"T00:00:00").toLocaleDateString("it-IT",{day:"numeric",month:"short"})} – ${new Date(weekDays[6]+"T00:00:00").toLocaleDateString("it-IT",{day:"numeric",month:"short",year:"numeric"})}`;

  // Calendar grid
  const firstDay = new Date(viewDate.y, viewDate.m, 1);
  const startWeekday = (firstDay.getDay()+6)%7;
  const daysInMonth = new Date(viewDate.y, viewDate.m+1, 0).getDate();
  const monthName = firstDay.toLocaleDateString("it-IT",{month:"long",year:"numeric"});
  const todayK = todayStr();

  const cells = [];
  for(let i=0;i<startWeekday;i++) cells.push(null);
  for(let d=1;d<=daysInMonth;d++){
    const k=`${viewDate.y}-${String(viewDate.m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    cells.push(k);
  }

  const getEventsForDay = (k) => events.filter(e=>{
    const start = e.start?.dateTime||e.start?.date||"";
    return start.startsWith(k);
  });

  const selectedEvents = getEventsForDay(selectedDay);
  const selLabel = new Date(selectedDay+"T00:00:00").toLocaleDateString("it-IT",{weekday:"long",day:"numeric",month:"long"});

  if(!token) return (
    <div className="fi">
      <Section title="📅 Calendario">
        <Card style={{textAlign:"center",padding:"32px 20px"}}>
          <div style={{fontSize:48,marginBottom:16}}>📅</div>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:18,color:C.text,marginBottom:8}}>Connetti Google Calendar</div>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.textDim,marginBottom:24}}>Accedi con il tuo account Google per vedere e gestire i tuoi eventi</div>
          <Btn onClick={()=>gcalLogin()} style={{justifyContent:"center",margin:"0 auto"}}>[ Connetti con Google ]</Btn>
        </Card>
      </Section>
    </div>
  );

  return (
    <div className="fi">
      <Section title="📅 Calendario" action={
        <Row gap={8}>
          {loading && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.textDim}}>⟳</div>}
          <Btn size="sm" onClick={()=>setModal(true)}>+ Evento</Btn>
          <Btn size="sm" variant="ghost" onClick={()=>{localStorage.removeItem("ts_gcal_token");setToken(null);setEvents([]);}}>Scollega</Btn>
        </Row>
      }>
        {/* View toggle */}
        <Row gap={6} style={{marginBottom:12}}>
          {[["month","Mese"],["week","Settimana"]].map(([v,l])=>(
            <button key={v} onClick={()=>setCalView(v)} style={{flex:1,background:calView===v?C.accentDim:"transparent",border:`1px solid ${calView===v?C.accent:C.border}`,borderRadius:5,color:calView===v?C.accent:C.textDim,cursor:"pointer",padding:"7px",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:14,letterSpacing:"0.08em",textTransform:"uppercase"}}>{l}</button>
          ))}
        </Row>

        {/* Month nav */}
        <Card style={{marginBottom:14}}>
          {calView==="month" && <>
          <Row style={{justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <button onClick={()=>setViewDate(v=>v.m===0?{y:v.y-1,m:11}:{y:v.y,m:v.m-1})} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,color:C.text,cursor:"pointer",padding:"4px 12px",fontSize:16}}>‹</button>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,color:C.accent,fontWeight:700,textTransform:"uppercase"}}>{monthName}</div>
            <button onClick={()=>setViewDate(v=>v.m===11?{y:v.y+1,m:0}:{y:v.y,m:v.m+1})} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,color:C.text,cursor:"pointer",padding:"4px 12px",fontSize:16}}>›</button>
          </Row>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
            {["L","M","M","G","V","S","D"].map((d,i)=>(
              <div key={i} style={{textAlign:"center",fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textMuted,padding:"2px 0"}}>{d}</div>
            ))}
            {cells.map((k,i)=>{
              if(!k) return <div key={i}/>;
              const day=parseInt(k.slice(-2));
              const isToday=k===todayK;
              const isSel=k===selectedDay;
              const dayEvs=getEventsForDay(k);
              return (
                <button key={i} onClick={()=>setSelectedDay(k)}
                  style={{aspectRatio:"1",background:isSel?C.accentDim:C.bg,border:`1px solid ${isSel?C.accent:isToday?C.gold:C.border}`,borderRadius:6,color:isSel?C.accent:isToday?C.gold:C.text,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:2,transition:"all .15s",position:"relative"}}>
                  <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,fontWeight:isToday?700:400}}>{day}</span>
                  {dayEvs.length>0 && <div style={{width:5,height:5,borderRadius:"50%",background:isSel?C.accent:C.success,marginTop:1}}/>}
                </button>
              );
            })}
          </div>
          </>}

          {calView==="week" && <>
            <Row style={{justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <button onClick={prevWeek} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,color:C.text,cursor:"pointer",padding:"4px 12px",fontSize:16}}>‹</button>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:13,color:C.accent,fontWeight:700,textTransform:"uppercase"}}>{weekLabel}</div>
              <button onClick={nextWeek} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,color:C.text,cursor:"pointer",padding:"4px 12px",fontSize:16}}>›</button>
            </Row>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
              {["L","M","M","G","V","S","D"].map((d,i)=>(
                <div key={i} style={{textAlign:"center",fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textMuted,paddingBottom:4}}>{d}</div>
              ))}
              {weekDays.map(k=>{
                const day=parseInt(k.slice(-2));
                const isToday=k===todayK;
                const isSel=k===selectedDay;
                const dayEvs=getEventsForDay(k);
                return (
                  <button key={k} onClick={()=>setSelectedDay(k)}
                    style={{background:isSel?C.accentDim:C.bg,border:`1px solid ${isSel?C.accent:isToday?C.gold:C.border}`,borderRadius:6,color:isSel?C.accent:isToday?C.gold:C.text,cursor:"pointer",padding:"8px 4px",display:"flex",flexDirection:"column",alignItems:"center",gap:3,transition:"all .15s",minHeight:52}}>
                    <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,fontWeight:isToday?700:400}}>{day}</span>
                    {dayEvs.slice(0,2).map((e,i)=>(
                      <div key={i} style={{width:"90%",background:C.success+"33",borderRadius:2,padding:"1px 3px",fontFamily:"'Rajdhani',sans-serif",fontSize:9,color:C.success,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.summary}</div>
                    ))}
                    {dayEvs.length>2 && <div style={{fontSize:9,color:C.textMuted}}>+{dayEvs.length-2}</div>}
                  </button>
                );
              })}
            </div>
          </>}
        </Card>

        {/* Selected day events */}
        <div style={{fontFamily:"'Cinzel',serif",fontSize:14,color:C.gold,textTransform:"capitalize",marginBottom:10}}>{selLabel}{selectedDay===todayK?" · oggi":""}</div>

        {selectedEvents.length===0 && (
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.textMuted,padding:"12px 0",textAlign:"center"}}>// Nessun evento questo giorno</div>
        )}

        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
          {selectedEvents.map(e=>{
            const start = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}) : "tutto il giorno";
            const end = e.end?.dateTime ? new Date(e.end.dateTime).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}) : "";
            return (
              <Card key={e.id} style={{borderColor:C.success+"44"}}>
                <Row style={{justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:16,color:C.text}}>{e.summary}</div>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.success,marginTop:3}}>{start}{end?` → ${end}`:""}</div>
                    {e.description && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textDim,marginTop:4}}>{e.description}</div>}
                  </div>
                  <button onClick={()=>deleteEvent(e.id)} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:15,flexShrink:0}}>×</button>
                </Row>
              </Card>
            );
          })}
        </div>

        {/* Upcoming events */}
        {events.length>0 && (
          <>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Prossimi eventi</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {events.slice(0,8).map(e=>{
                const start = e.start?.dateTime||e.start?.date||"";
                const dateStr = start ? new Date(start).toLocaleDateString("it-IT",{day:"numeric",month:"short"}) : "";
                const timeStr = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}) : "";
                return (
                  <Row key={e.id} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 12px",justifyContent:"space-between",cursor:"pointer"}} onClick={()=>{setSelectedDay(start.slice(0,10));setViewDate({y:new Date(start).getFullYear(),m:new Date(start).getMonth()});}}>
                    <div>
                      <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:14,color:C.text,fontWeight:600}}>{e.summary}</div>
                      <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textDim}}>{dateStr} {timeStr}</div>
                    </div>
                  </Row>
                );
              })}
            </div>
          </>
        )}
      </Section>

      {modal && (
        <Modal title="Nuovo Evento" onClose={()=>setModal(false)}>
          <Label>Titolo</Label>
          <Input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Es. Call con cliente..."/>
          <Grid cols={2} gap={8}>
            <div><Label>Data</Label><Input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></div>
            <div><Label>Ora</Label><Input type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})}/></div>
          </Grid>
          <Label>Durata (minuti)</Label>
          <Select value={form.duration} onChange={e=>setForm({...form,duration:parseInt(e.target.value)})}>
            {[15,30,45,60,90,120,180,240].map(d=><option key={d} value={d}>{d} min</option>)}
          </Select>
          <Label>Note (opz.)</Label>
          <Input value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="Descrizione evento..."/>
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setModal(false)}>Annulla</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={createEvent}>[ CREA EVENTO ]</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
};

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [sbConnected, setSbConnected] = useState(!!getSB());
  const [session, setSession] = useState(()=>sbAuth.getSession());
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const handleLogin = async () => {
    setLoginLoading(true); setLoginError("");
    const res = await sbAuth.signIn(loginEmail, loginPassword);
    if(res.error) { setLoginError(res.error); setLoginLoading(false); return; }
    setSession(res);
    setLoginLoading(false);
  };

  const handleLogout = () => { sbAuth.signOut(); setSession(null); };

  // Data state - all from Supabase
  const [clients, setClients] = useState([]);
  const [leads, setLeads] = useState([]);
  const [quests, setQuests] = useState(DEFAULT_FIXED);
  const [tasks, setTasks] = useState([]);
  const [ideas, setIdeas] = useState([]);
  const [goals, setGoals] = useState([]);
  const [notes, setNotes] = useState([]);
  const [payments, setPayments] = useState([]);
  const [workoutLog, setWorkoutLog] = useState({});
  const [dietLog, setDietLog] = useState({});
  const [moodLog, setMoodLog] = useState({});
  const [weightLog, setWeightLog] = useState([]);
  const [habits, setHabits] = useState([]);
  const [habitLog, setHabitLog] = useState({});
  const [smokeLog, setSmokeLog] = useState({});
  const [focusLog, setFocusLog] = useState({});
  const [projects, setProjects] = useState([]);
  const [slotDays, setSlotDays] = useState(0);
  const [slotStart, setSlotStart] = useState("");
  const [apiKeys, setApiKeys] = useState({apify:"",anthropic:""});
  const [showKeys, setShowKeys] = useState(false);
  const [keyDraft, setKeyDraft] = useState({apify:"",anthropic:"",sbUrl:"",sbKey:""});
  const [aiQuestModal, setAiQuestModal] = useState(false);
  const [aiQuestSuggestions, setAiQuestSuggestions] = useState(null);
  const [aiQuestLoading, setAiQuestLoading] = useState(false);
  const [weeklyModal, setWeeklyModal] = useState(false);
  const [weeklyReport, setWeeklyReport] = useState(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const stateRef = useRef({});

  const openKeys = () => { setKeyDraft({...apiKeys, sbUrl:LS.get("ts_sb_url",""), sbKey:LS.get("ts_sb_key","")}); setShowKeys(true); };
  const saveKeys = () => {
    const keys = {apify:keyDraft.apify, anthropic:keyDraft.anthropic};
    setApiKeys(keys);
    if(keyDraft.sbUrl) LS.set("ts_sb_url", keyDraft.sbUrl);
    if(keyDraft.sbKey) LS.set("ts_sb_key", keyDraft.sbKey);
    setSbConnected(!!getSB());
    // Save to Supabase so it syncs across devices
    DB.setSetting("api_keys", keys);
    setShowKeys(false);
  };

  const addToLeads = (lead) => { setLeads(p=>[...p,lead]); pushItem("leads",lead); };

  // Load from Supabase on mount / login
  useEffect(()=>{
    if(!session||!getSB()) { setLoaded(true); return; }
    (async()=>{
      try {
        const data = await DB.pullAll();
        if(data){
          if(data.clients) setClients(data.clients);
          if(data.leads) setLeads(data.leads);
          if(data.ideas) setIdeas(data.ideas);
          if(data.goals) setGoals(data.goals);
          if(data.notes) setNotes(data.notes);
          if(data.payments) setPayments(data.payments);
          if(data.habits) setHabits(data.habits);
          if(data.workoutLog) setWorkoutLog(data.workoutLog);
          if(data.dietLog) setDietLog(data.dietLog);
          if(data.moodLog) setMoodLog(data.moodLog);
          if(data.weightLog) setWeightLog(data.weightLog);
          if(data.habitLog) setHabitLog(data.habitLog);
          if(data.slotDays!==undefined) setSlotDays(data.slotDays);
          if(data.slotStart) setSlotStart(data.slotStart);
          if(data.smokeLog) setSmokeLog(data.smokeLog);
          if(data.focusLog) setFocusLog(data.focusLog);
          if(data.projects) setProjects(data.projects);
          if(data.apiKeys) setApiKeys(data.apiKeys);
          // Tasks: Supabase wins
          if(data.tasks) setTasks(data.tasks);
          // Quests: load but filter done ones
          if(data.quests){
            const t=todayStr(); const lr=data.lastReset||"";
            if(lr!==t){
              // New day - reset fixed quests, remove variable done ones
              const reset=data.quests.filter(q=>q.fixed).map(q=>({...q,done:false}));
              setQuests(reset.length?reset:DEFAULT_FIXED);
              DB.setSetting("last_reset",t);
            } else {
              // Same day - show only undone quests (variable) + all fixed
              setQuests(data.quests.filter(q=>q.fixed||!q.done));
            }
          }
        }
        setSbConnected(true);
      } catch(e){ console.error("Pull failed:", e); }
      setLoaded(true);
    })();
  },[session]);

  // Expose stateRef globally
  stateRef.current = {clients,leads,quests,tasks,ideas,goals,notes,payments,workoutLog,dietLog,moodLog,weightLog,habitLog,habits,slotDays,slotStart,apiKeys,smokeLog,focusLog,projects};
  window.__stateRef = stateRef;

  // Auto-push settings-based data (logs) to Supabase on change
  useEffect(()=>{ if(loaded&&getSB()) DB.setSetting("workout_log",workoutLog); },[workoutLog]);
  useEffect(()=>{ if(loaded&&getSB()) DB.setSetting("diet_log",dietLog); },[dietLog]);
  useEffect(()=>{ if(loaded&&getSB()) DB.setSetting("mood_log",moodLog); },[moodLog]);
  useEffect(()=>{ if(loaded&&getSB()) DB.setSetting("weight_log",weightLog); },[weightLog]);
  useEffect(()=>{ if(loaded&&getSB()) DB.setSetting("habit_log",habitLog); },[habitLog]);
  useEffect(()=>{ if(loaded&&getSB()) DB.setSetting("habits",habits); },[habits]);
  useEffect(()=>{ if(loaded&&getSB()) DB.setSetting("smoke_log",smokeLog); },[smokeLog]);
  useEffect(()=>{ if(loaded&&getSB()) DB.setSetting("focus_log",focusLog); },[focusLog]);
  useEffect(()=>{ if(loaded&&getSB()) DB.setSetting("slot_days",slotDays); },[slotDays]);
  useEffect(()=>{ if(loaded&&getSB()) DB.setSetting("slot_start",slotStart); },[slotStart]);

  // AI quest generation on first open of day (weekdays only)
  useEffect(()=>{
    if(!loaded) return;
    const today = todayStr();
    const dayOfWeek = new Date().getDay();
    if(dayOfWeek === 0 || dayOfWeek === 6) return;
    const key = apiKeys.anthropic;
    if(!key) return;
    (async()=>{
      const lastAiQuest = await DB.getSetting("ai_quest_date","");
      if(lastAiQuest === today || lastAiQuest === `"${today}"`) return;
      const timer = setTimeout(async()=>{
      setAiQuestLoading(true);
      try {
        const openTasks = tasks.filter(t=>!t.done).slice(0,5).map(t=>t.text);
        const ctx = `Sei The System, l'AI di Andrea (freelance web design, Studio Brillo, Vicenza).
Oggi è ${today}. Genera 3-5 quest variabili personalizzate per la giornata di Andrea.
- Task aperti (NON replicare): ${openTasks.join(", ")||"nessuno"}
- Lead in trattativa: ${leads.filter(l=>l.stage==="In trattativa").map(l=>l.name).join(", ")||"nessuno"}
- Clienti attivi: ${clients.filter(c=>!["Consegnato","Pagato"].includes(c.stage)).map(c=>c.name).join(", ")||"nessuno"}
Le quest devono essere SPECIFICHE e ACTIONABLE per oggi, NON duplicare i task. Rispondi SOLO con JSON:
{"quests":["testo quest 1","testo quest 2","testo quest 3"]}`;
        const res = await fetch("https://apify-worker.luciettiandrea.workers.dev/anthropic/v1/messages",{
          method:"POST",
          headers:{"Content-Type":"application/json","x-api-key":key},
          body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:300,messages:[{role:"user",content:ctx}]})
        });
        const d = await res.json();
        const parsed = JSON.parse((d.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim());
        if(parsed.quests?.length){
          setAiQuestSuggestions(parsed.quests);
          setAiQuestModal(true);
          DB.setSetting("ai_quest_date", today);
        }
      } catch(e){ console.log("AI quest failed:", e); }
      setAiQuestLoading(false);
    }, 2000);
    })();
  },[loaded]);

  const generateWeeklyReport = async () => {
    const key = apiKeys.anthropic;
    if(!key){ openKeys(); return; }
    setWeeklyLoading(true);
    setWeeklyModal(true);
    try {
      const now = new Date();
      const days = Array.from({length:7},(_,i)=>{const d=new Date(now);d.setDate(now.getDate()-6+i);return d.toISOString().slice(0,10);});
      const tasksDone = tasks.filter(t=>t.done&&t.done_at&&days.includes(t.done_at)).length;
      const moodAvgs = days.map(d=>{const l=moodLog[d];if(!l?.scores||!Object.keys(l.scores).length)return null;return Object.values(l.scores).reduce((a,b)=>a+b,0)/Object.values(l.scores).length;}).filter(Boolean);
      const moodAvg = moodAvgs.length?(moodAvgs.reduce((a,b)=>a+b,0)/moodAvgs.length).toFixed(1):"N/D";
      const newLeads = leads.filter(l=>l.createdAt&&days.includes(l.createdAt)).length;
      const weekPayments = payments.filter(p=>p.date&&days.includes(p.date));
      const weekIncome = weekPayments.reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
      const weekSmokes = days.reduce((s,d)=>s+(smokeLog[d]||0),0);
      const avgSmokes = (weekSmokes/7).toFixed(1);
      const prompt = `Sei The System, l'AI di Andrea (freelance web design, Studio Brillo, Vicenza).
Analizza la settimana (${days[0]} → ${days[6]}):
- Task completati: ${tasksDone}
- Nuovi lead: ${newLeads}
- Incassato: €${weekIncome}
- Mood medio: ${moodAvg}/5
- Sigarette: ${weekSmokes} totali (${avgSmokes}/giorno)
- Clienti attivi: ${clients.filter(c=>!["Consegnato","Pagato"].includes(c.stage)).length}
Scrivi un report settimanale in italiano:
1. **Valutazione generale** (voto 1-10)
2. **Cosa è andato bene** (2-3 punti)
3. **Cosa migliorare** (2-3 punti)
4. **3 priorità per la prossima settimana**
Tono diretto, da coach.`;
      const res = await fetch("https://apify-worker.luciettiandrea.workers.dev/anthropic/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":key},
        body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:600,messages:[{role:"user",content:prompt}]})
      });
      const d = await res.json();
      setWeeklyReport(d.content?.[0]?.text||"Errore.");
    } catch(e){ setWeeklyReport("Errore: "+e.message); }
    setWeeklyLoading(false);
  };

  const nav = [
    {id:"dashboard",label:"Home"},
    {id:"quests",label:"Quest"},
    {id:"tasknotes",label:"Task"},
    {id:"agent",label:"Agent"},
    {id:"brainstorm",label:"Ideas"},
    {id:"salute",label:"Salute"},
    {id:"checkin",label:"Check-in"},
    {id:"diary",label:"Diario"},
    {id:"goals",label:"Goals"},
    {id:"clients",label:"Clienti"},
    {id:"finance",label:"Finanze"},
    {id:"calendar",label:"Calendario"},
    {id:"settings",label:"Setup"},
  ];

  const NAV_ICONS = {
    dashboard:"M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    quests:"M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z",
    tasknotes:"M9 11l3 3L22 4M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z",
    agent:"M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    brainstorm:"M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
    salute:"M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l7.78-7.78a5.5 5.5 0 000-7.78z",
    checkin:"M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
    diary:"M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.247m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.247",
    goals:"M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z",
    clients:"M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    finance:"M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    leads:"M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
    calendar:"M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    settings:"M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
  };

  if(!session && getSB()) {
    return (
      <div style={{minHeight:"100dvh",background:"#03030a",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <GS/>
        <div style={{width:"100%",maxWidth:380}}>
          <div style={{textAlign:"center",marginBottom:32}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:28,fontWeight:900,color:"#4fc3f7",letterSpacing:"0.25em",textShadow:"0 0 30px #4fc3f744"}} className="rp">THE SYSTEM</div>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:"#384560",letterSpacing:"0.15em",marginTop:6}}>STUDIO BRILLO // PLAYER ACCESS</div>
          </div>
          <div style={{background:"#07071a",border:"1px solid #1a1a3a",borderRadius:10,padding:28}}>
            <div style={{marginBottom:14}}>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:11,color:"#384560",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6}}>Email</div>
              <input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="email" style={{width:"100%",background:"#03030a",border:"1px solid #1a1a3a",borderRadius:6,color:"#ccd6f0",padding:"11px 13px",fontSize:14,fontFamily:"'Share Tech Mono',monospace",outline:"none",boxSizing:"border-box"}}/>
            </div>
            <div style={{marginBottom:20}}>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:11,color:"#384560",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6}}>Password</div>
              <input type="password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="••••••••" style={{width:"100%",background:"#03030a",border:"1px solid #1a1a3a",borderRadius:6,color:"#ccd6f0",padding:"11px 13px",fontSize:14,fontFamily:"'Share Tech Mono',monospace",outline:"none",boxSizing:"border-box"}}/>
            </div>
            {loginError && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:"#f44336",marginBottom:14}}>{loginError}</div>}
            <button onClick={handleLogin} disabled={loginLoading} style={{width:"100%",background:"#0a0a2a",border:"1px solid #4fc3f7",borderRadius:6,color:"#4fc3f7",padding:"13px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:14,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>
              {loginLoading?"[ ACCESSO... ]":"[ ACCEDI ]"}
            </button>
          </div>
          <div style={{textAlign:"center",marginTop:20}}>
            <button onClick={()=>setShowKeys(!showKeys)} style={{background:"none",border:"none",color:"#384560",cursor:"pointer",fontFamily:"'Share Tech Mono',monospace",fontSize:10}}>configura supabase</button>
          </div>
          {showKeys && (
            <div style={{marginTop:16,background:"#07071a",border:"1px solid #1a1a3a",borderRadius:10,padding:20}}>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:11,color:"#384560",marginBottom:8}}>SUPABASE URL</div>
              <input value={keyDraft.sbUrl||""} onChange={e=>setKeyDraft({...keyDraft,sbUrl:e.target.value})} placeholder="https://xxx.supabase.co" style={{width:"100%",background:"#03030a",border:"1px solid #1a1a3a",borderRadius:6,color:"#ccd6f0",padding:"9px",fontSize:12,fontFamily:"'Share Tech Mono',monospace",outline:"none",boxSizing:"border-box",marginBottom:8}}/>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:11,color:"#384560",marginBottom:8}}>ANON KEY</div>
              <input type="password" value={keyDraft.sbKey||""} onChange={e=>setKeyDraft({...keyDraft,sbKey:e.target.value})} placeholder="eyJ..." style={{width:"100%",background:"#03030a",border:"1px solid #1a1a3a",borderRadius:6,color:"#ccd6f0",padding:"9px",fontSize:12,fontFamily:"'Share Tech Mono',monospace",outline:"none",boxSizing:"border-box",marginBottom:12}}/>
              <button onClick={saveKeys} style={{width:"100%",background:"#0a0a2a",border:"1px solid #4fc3f7",borderRadius:6,color:"#4fc3f7",padding:"9px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:12,fontWeight:700}}>SALVA</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{minHeight:"100dvh",background:C.bg,color:C.text,fontSize:window.innerWidth>1400?"20px":window.innerWidth>1100?"18px":window.innerWidth>768?"16px":"14px"}}>
      <GS/>
      {/* Fixed header */}
      <div style={{position:"fixed",top:0,left:0,right:0,zIndex:50,background:C.bg,borderBottom:`1px solid ${C.border}`}}>
        <Row style={{padding:"10px clamp(14px,4vw,60px) 0",justifyContent:"space-between"}}>
          <div>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:14,fontWeight:900,color:C.accent,letterSpacing:"0.25em",textShadow:`0 0 20px ${C.accent}44`}} className="rp">THE SYSTEM</div>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:"#384560",letterSpacing:"0.12em"}}>PLAYER: ANDREA // STUDIO BRILLO</div>
          </div>
          <Row gap={8}>
            {syncing && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:6,color:C.gold}}>⟳</div>}
            {syncError && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:6,color:C.danger,cursor:"pointer"}} onClick={async()=>{const t=await sbAuth.getValidToken();if(t){setSyncing(true);await DB.pushAll(stateRef.current);setLastSync(new Date());setSyncError(false);setSyncing(false);}}}>⚠ RETRY</div>}
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:syncError?C.danger:sbConnected?C.success:C.danger}}>
              {syncError?"● ERR":sbConnected?"● SYNC":"○ OFFLINE"}
            </div>
            <Btn variant="ghost" size="sm" onClick={openKeys} style={{fontSize:16,padding:"3px 8px"}}>API</Btn>
          </Row>
        </Row>
        <div style={{display:"flex",overflowX:"auto",scrollbarWidth:"none",marginTop:8,borderTop:`1px solid ${C.border}`,padding:`0 clamp(14px,4vw,60px)`}}>
          {nav.map(({id,label})=>{
            const active = tab===id;
            const path = NAV_ICONS[id]||"";
            return (
              <button key={id} onClick={()=>setTab(id)} style={{color:active?C.accent:"#384560",cursor:"pointer",padding:"7px 11px",fontFamily:"'Rajdhani',sans-serif",fontSize:"clamp(8px,1vw,12px)",letterSpacing:"0.08em",textTransform:"uppercase",transition:"all .2s",display:"flex",flexDirection:"column",alignItems:"center",gap:3,fontWeight:active?700:400,background:"none",border:"none",borderBottom:`2px solid ${active?C.accent:"transparent"}`,flexShrink:0}}>
                <svg width={active?17:15} height={active?17:15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={path}/></svg>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div style={{padding:"96px clamp(14px,4vw,60px) 50px",maxWidth:860,margin:"0 auto"}}>
        {!loaded && <div style={{textAlign:"center",padding:"60px 0",fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.textDim}}>// caricamento dati...</div>}
        {loaded && (
          <>
            {tab==="dashboard" && <Dashboard clients={clients} leads={leads} quests={quests} tasks={tasks} workoutLog={workoutLog} dietLog={dietLog} moodLog={moodLog} goals={goals} payments={payments} onWeeklyReview={generateWeeklyReport} anthropicKey={apiKeys.anthropic} smokeLog={smokeLog} setSmokeLog={setSmokeLog}/>}
            {tab==="quests" && <QuestsView quests={quests} setQuests={setQuests} moodLog={moodLog} anthropicKey={apiKeys.anthropic} onNeedKey={openKeys}/>}
            {tab==="tasknotes" && <TaskNotesView tasks={tasks} setTasks={setTasks} notes={notes} setNotes={setNotes} projects={projects} setProjects={setProjects} anthropicKey={apiKeys.anthropic} onNeedKey={openKeys} clients={clients}/>}
            {tab==="agent" && <AgentView clients={clients} leads={leads} quests={quests} tasks={tasks} ideas={ideas} workoutLog={workoutLog} dietLog={dietLog} moodLog={moodLog} anthropicKey={apiKeys.anthropic} onNeedKey={openKeys}/>}
            {tab==="brainstorm" && <BrainstormView ideas={ideas} setIdeas={setIdeas} anthropicKey={apiKeys.anthropic} onNeedKey={openKeys}/>}
            {tab==="salute" && <SaluteView workoutLog={workoutLog} setWorkoutLog={setWorkoutLog} dietLog={dietLog} setDietLog={setDietLog} weightLog={weightLog} setWeightLog={setWeightLog}/>}
            {tab==="checkin" && <CheckinView moodLog={moodLog} setMoodLog={setMoodLog} habits={habits} setHabits={setHabits} habitLog={habitLog} setHabitLog={setHabitLog} slotDays={slotDays} slotStart={slotStart} setSlotDays={setSlotDays} setSlotStart={setSlotStart} smokeLog={smokeLog} setSmokeLog={setSmokeLog} focusLog={focusLog} setFocusLog={setFocusLog}/>}
            {tab==="diary" && <DiaryView moodLog={moodLog} setMoodLog={setMoodLog} dietLog={dietLog} setDietLog={setDietLog} smokeLog={smokeLog} setSmokeLog={setSmokeLog} workoutLog={workoutLog} setWorkoutLog={setWorkoutLog} focusLog={focusLog} setFocusLog={setFocusLog} anthropicKey={apiKeys.anthropic}/>}
            {tab==="goals" && <GoalsView goals={goals} setGoals={setGoals}/>}
            {tab==="clients" && <ClientsView clients={clients} setClients={setClients}/>}
            {tab==="finance" && <FinanceView clients={clients} payments={payments} setPayments={setPayments}/>}
            {tab==="calendar" && <div style={{padding:20,fontFamily:"'Share Tech Mono',monospace",color:"#4fc3f7",textAlign:"center",marginTop:40}}>📅 Calendario in manutenzione</div>}
            {tab==="settings" && <SettingsView quests={quests} setQuests={setQuests} clients={clients} leads={leads} tasks={tasks} ideas={ideas} goals={goals} notes={notes} payments={payments} workoutLog={workoutLog} dietLog={dietLog} moodLog={moodLog} weightLog={weightLog} habits={habits} habitLog={habitLog} slotDays={slotDays} slotStart={slotStart} apiKeys={apiKeys} keyDraft={keyDraft} setKeyDraft={setKeyDraft} saveKeys={saveKeys} onSyncNow={()=>DB.pushAll(stateRef.current)}/>}
          </>
        )}
      </div>

      {/* Modals */}
      {weeklyModal && (
        <Modal title="📊 Review Settimanale" onClose={()=>{setWeeklyModal(false);setWeeklyReport(null);}}>
          {weeklyLoading && <div style={{textAlign:"center",padding:"30px 0",fontFamily:"'Share Tech Mono',monospace",fontSize:13,color:C.accent}}>Analisi in corso...</div>}
          {weeklyReport && !weeklyLoading && (
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:C.text,lineHeight:1.8,whiteSpace:"pre-wrap"}}>
              {weeklyReport.split("**").map((part,i)=>i%2===1?<strong key={i} style={{color:C.accent}}>{part}</strong>:<span key={i}>{part}</span>)}
            </div>
          )}
          {!weeklyLoading && <Btn style={{width:"100%",justifyContent:"center",marginTop:16}} onClick={()=>{setWeeklyModal(false);setWeeklyReport(null);}}>[ CHIUDI ]</Btn>}
        </Modal>
      )}
      {aiQuestModal && aiQuestSuggestions && (
        <Modal title="⚡ Quest del Giorno — AI" onClose={()=>setAiQuestModal(false)}>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:13,color:C.textDim,marginBottom:14}}>The System suggerisce queste quest per oggi:</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
            {aiQuestSuggestions.map((q,i)=>(
              <div key={i} style={{background:C.bg,border:`1px solid ${C.borderHi}`,borderRadius:6,padding:"10px 14px",fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.text,lineHeight:1.5}}>
                <span style={{color:C.accent,marginRight:8}}>{i+1}.</span>{q}
              </div>
            ))}
          </div>
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setAiQuestModal(false)}>Ignora</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={()=>{
              const newQ = aiQuestSuggestions.map(text=>({id:uid(),text,done:false,fixed:false}));
              setQuests(q=>[...q.filter(x=>x.fixed),...newQ]);
              newQ.forEach(q=>pushItem("quests",q));
              setAiQuestModal(false);
            }}>[ AGGIUNGI ]</Btn>
          </Row>
        </Modal>
      )}
      {showKeys && (
        <Modal title="System Configuration" onClose={()=>setShowKeys(false)}>
          <Card style={{marginBottom:10}}>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:10,color:C.accent,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>API Keys</div>
            <Label>Anthropic API Key</Label>
            <Input type="password" value={keyDraft.anthropic||""} onChange={e=>setKeyDraft({...keyDraft,anthropic:e.target.value})} placeholder="sk-ant-..."/>
            <Label>Apify API Key</Label>
            <Input type="password" value={keyDraft.apify||""} onChange={e=>setKeyDraft({...keyDraft,apify:e.target.value})} placeholder="apify_api_..."/>
          </Card>
          <Card style={{marginBottom:10,borderColor:C.success+"33"}}>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:10,color:C.success,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Supabase</div>
            <Label>Project URL</Label>
            <Input value={keyDraft.sbUrl||""} onChange={e=>setKeyDraft({...keyDraft,sbUrl:e.target.value})} placeholder="https://xxxx.supabase.co"/>
            <Label>Anon Public Key</Label>
            <Input type="password" value={keyDraft.sbKey||""} onChange={e=>setKeyDraft({...keyDraft,sbKey:e.target.value})} placeholder="eyJ..."/>
          </Card>
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setShowKeys(false)}>Annulla</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={saveKeys}>[ Salva ]</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
}
