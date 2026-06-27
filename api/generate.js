export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { materia, tema, tipo } = req.body || {};
  if (!materia || !tema || !tipo) return res.status(400).json({ error: "Faltan parámetros" });

  const NOMBRES = {
    fisica: "Física", quimica: "Química", matematicas: "Matemáticas",
    biologia: "Biología", salud: "Ciencias de la Salud"
  };
  const EMOJIS = { fisica:"⚛️", quimica:"🧪", matematicas:"📐", biologia:"🌿", salud:"🩺" };

  try {
    // ══════════════════════════════════
    // PASO 1 — Buscar página Wikipedia ES
    // ══════════════════════════════════
    const buscarWikiEs = async (query) => {
      // Intento directo
      let r = await fetch(
        `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
        { headers: { "User-Agent": "AcademiaMY10/3.0 (educacion)" } }
      );
      if (r.ok) {
        const d = await r.json();
        if (d.type !== "disambiguation" && d.extract?.length > 120) return d;
      }
      // Búsqueda libre
      r = await fetch(
        `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query+" "+NOMBRES[materia])}&format=json&utf8=1&srlimit=5&origin=*`
      );
      const sd = await r.json();
      for (const hit of (sd?.query?.search || [])) {
        const pr = await fetch(
          `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`,
          { headers: { "User-Agent": "AcademiaMY10/3.0" } }
        );
        if (pr.ok) {
          const pd = await pr.json();
          if (pd.extract?.length > 120) return pd;
        }
      }
      return null;
    };

    // ══════════════════════════════════
    // PASO 2 — Extraer texto COMPLETO
    // ══════════════════════════════════
    const extraerTextoCompleto = async (titulo) => {
      const r = await fetch(
        `https://es.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titulo)}&prop=extracts&exintro=false&explaintext=true&exsectionformat=plain&format=json&utf8=1&origin=*&exlimit=1`
      );
      if (!r.ok) return "";
      const d = await r.json();
      const pages = d?.query?.pages || {};
      return Object.values(pages)[0]?.extract || "";
    };

    // ══════════════════════════════════
    // PASO 3 — Secciones del artículo
    // ══════════════════════════════════
    const obtenerSecciones = async (titulo) => {
      const r = await fetch(
        `https://es.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(titulo)}&prop=sections&format=json&origin=*`
      );
      if (!r.ok) return [];
      const d = await r.json();
      return (d?.parse?.sections || [])
        .map(s => s.line.replace(/<[^>]+>/g, "").trim())
        .filter(s => s.length > 2)
        .slice(0, 14);
    };

    // ══════════════════════════════════
    // PASO 4 — Wikipedia EN como respaldo
    // ══════════════════════════════════
    const buscarWikiEn = async (query) => {
      const r = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
        { headers: { "User-Agent": "AcademiaMY10/3.0" } }
      );
      if (r.ok) { const d = await r.json(); if (d.extract) return d; }
      return null;
    };

    // ══════════════════════════════════
    // PASO 5 — Ejecutar en paralelo
    // ══════════════════════════════════
    const [wikiEs, wikiEn] = await Promise.all([
      buscarWikiEs(tema),
      buscarWikiEn(tema)
    ]);

    const tituloPagina = wikiEs?.title || wikiEn?.title || tema;
    const urlWiki = wikiEs?.content_urls?.desktop?.page
      || `https://es.wikipedia.org/wiki/${encodeURIComponent(tema)}`;

    const [textoCompleto, secciones] = await Promise.all([
      wikiEs ? extraerTextoCompleto(tituloPagina) : Promise.resolve(""),
      wikiEs ? obtenerSecciones(tituloPagina) : Promise.resolve([])
    ]);

    // ══════════════════════════════════
    // PROCESAMIENTO DEL TEXTO
    // ══════════════════════════════════
    const limpiar = (txt) => txt
      .replace(/\[[\d\w\s,]+\]/g, "")
      .replace(/={2,}[^=]+=={2,}/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\t/g, " ")
      .trim();

    const textoBase  = limpiar(textoCompleto || wikiEs?.extract || wikiEn?.extract || "");
    const extractoCorto = limpiar(wikiEs?.extract || wikiEn?.extract || "");

    // Párrafos (bloques de texto separados por doble salto)
    const parrafos = textoBase
      .split(/\n{2,}/)
      .map(p => p.replace(/\n/g, " ").trim())
      .filter(p => p.length > 80 && !/^(Véase|Ver también|Referencias|Bibliografía|Notas|Enlaces)/i.test(p));

    // Oraciones individuales con sustancia
    const oraciones = textoBase
      .split(/(?<=[.!?])\s+/)
      .map(o => o.trim())
      .filter(o => o.length > 55 && o.length < 550 && /[a-záéíóúñ]/i.test(o));

    // Oraciones de definición (primeras del artículo)
    const definicion = oraciones.slice(0, 5);

    // Oraciones conceptuales (contienen palabras clave académicas)
    const conceptuales = oraciones.filter(o =>
      /\b(se define|se conoce|consiste|principio|ley|teoría|fórmula|ecuación|concepto|propiedad|proceso|mecanismo|función|estructura|sistema|relación|depende|determina|caracteriza|denomina|clasifica)\b/i.test(o)
    ).slice(0, 8);

    // Oraciones históricas / contexto
    const historicas = oraciones.filter(o =>
      /\b(fue|descubrió|demostró|formuló|propuso|publicó|desarrolló|estableció|primera vez|siglo|año|historia|origen|fundador|científico|investigador)\b/i.test(o)
    ).slice(0, 4);

    // Oraciones de aplicación
    const aplicaciones = oraciones.filter(o =>
      /\b(se aplica|utiliza|emplea|permite|posibilita|fundamental|importante|esencial|base de|tecnología|industria|medicina|ingeniería|cotidian|práctic)\b/i.test(o)
    ).slice(0, 5);

    // ══════════════════════════════════
    // CONSTRUIR RESPUESTA ACADÉMICA
    // ══════════════════════════════════
    const mat    = materia;
    const nom    = NOMBRES[mat] || materia;
    const emoji  = EMOJIS[mat] || "📚";
    let   texto  = "";

    const sep = "══════════════════════";

    // ── ENCABEZADO ──
    texto += `${emoji} *${tituloPagina.toUpperCase()}*\n`;
    texto += `📚 ${nom} | Academia MY 10\n`;
    texto += `${sep}\n\n`;

    // ══════════════════════════════════
    // RESUMEN / TODO
    // ══════════════════════════════════
    if (tipo === "resumen" || tipo === "todo") {

      // 1. Definición académica
      texto += `📌 *DEFINICIÓN*\n`;
      if (definicion.length > 0) {
        texto += definicion.slice(0, 3).join(" ") + "\n\n";
      } else {
        texto += `${tema} es un concepto fundamental en ${nom}.\n\n`;
      }

      // 2. Puntos clave distribuidos a lo largo del texto
      texto += `✅ *PUNTOS CLAVE*\n`;
      if (conceptuales.length >= 4) {
        conceptuales.slice(0, 6).forEach(o => {
          texto += `• ${o.slice(0, 230)}\n`;
        });
      } else if (oraciones.length >= 4) {
        const paso = Math.max(1, Math.floor(oraciones.length / 6));
        [0, paso, paso*2, paso*3, paso*4, paso*5].forEach(idx => {
          if (oraciones[idx]) texto += `• ${oraciones[idx].slice(0, 220)}\n`;
        });
      }
      texto += "\n";

      // 3. Desarrollo (párrafos 2 y 3 del artículo)
      if (parrafos.length >= 2) {
        texto += `📖 *DESARROLLO*\n`;
        parrafos.slice(1, 4).forEach(p => {
          texto += `${p.slice(0, 400)}\n\n`;
        });
      }

      // 4. Contexto histórico
      if (historicas.length > 0) {
        texto += `⏳ *CONTEXTO HISTÓRICO*\n`;
        historicas.slice(0, 3).forEach(h => {
          texto += `• ${h.slice(0, 220)}\n`;
        });
        texto += "\n";
      }

      // 5. Aplicaciones reales
      if (aplicaciones.length > 0) {
        texto += `🌍 *APLICACIONES REALES*\n`;
        aplicaciones.slice(0, 3).forEach(a => {
          texto += `• ${a.slice(0, 220)}\n`;
        });
        texto += "\n";
      }
    }

    // ══════════════════════════════════
    // FÓRMULAS Y CONCEPTOS
    // ══════════════════════════════════
    if (tipo === "formulas" || tipo === "todo") {
      texto += `${sep}\n`;
      texto += `🔣 *FÓRMULAS Y CONCEPTOS CLAVE*\n\n`;

      const fDB = getFormulasDB(mat, tema);
      if (fDB) {
        texto += fDB + "\n";
      } else if (conceptuales.length > 0) {
        texto += `📌 *Según Wikipedia:*\n`;
        conceptuales.slice(0, 5).forEach(c => texto += `📌 ${c.slice(0, 260)}\n`);
      }

      // Secciones del artículo como índice temático
      if (secciones.length > 0) {
        texto += `\n🗂️ *SUBTEMAS EN ESTE ARTÍCULO:*\n`;
        secciones.slice(0, 10).forEach(s => texto += `  → ${s}\n`);
      }
      texto += "\n";
    }

    // ══════════════════════════════════
    // EJERCICIO RESUELTO
    // ══════════════════════════════════
    if (tipo === "ejercicios" || tipo === "todo") {
      texto += `${sep}\n`;
      texto += `✏️ *EJERCICIO RESUELTO PASO A PASO*\n\n`;
      texto += getEjercicioDB(mat, tema, oraciones);
      texto += "\n";
    }

    // ══════════════════════════════════
    // EJEMPLOS PRÁCTICOS
    // ══════════════════════════════════
    if (tipo === "ejemplos" || tipo === "todo") {
      texto += `${sep}\n`;
      texto += `💡 *EJEMPLOS Y APLICACIONES PRÁCTICAS*\n\n`;
      texto += getEjemplosDB(mat, tema);

      // Dato curioso de Wikipedia
      const curioso = oraciones.find(o =>
        /\b(primera vez|descubri|record|mayor|más grande|único|notable|curiosamente|sorprendente|sin embargo|paradójicamente)\b/i.test(o)
        && o.length > 70
      );
      if (curioso) {
        texto += `\n⭐ *DATO DESTACADO:*\n${curioso.slice(0, 300)}\n`;
      }
    }

    // ══════════════════════════════════
    // SOLO GRÁFICAS — descripción textual
    // ══════════════════════════════════
    if (tipo === "graficas") {
      texto += `📊 *DATOS Y CIFRAS CLAVE*\n\n`;
      texto += getCifrasDB(mat, tema);
      if (parrafos.length > 0) {
        texto += `\n📖 *DESCRIPCIÓN:*\n${parrafos[0].slice(0, 500)}\n`;
      }
    }

    // ══════════════════════════════════
    // PIE DE PÁGINA ACADÉMICO
    // ══════════════════════════════════
    texto += `${sep}\n`;
    texto += `📚 *FUENTE:* Wikipedia — "${tituloPagina}"\n`;
    texto += `🔗 ${urlWiki}\n`;
    texto += `\n📲 *Academia MY 10* — ¡Todo por WhatsApp! 🏆\n`;
    texto += `_Verifica siempre con tu docente o bibliografía oficial._`;

    return res.status(200).json({
      texto,
      fuente: urlWiki,
      titulo: tituloPagina,
      seccionesCount: secciones.length,
      parrafosCount: parrafos.length
    });

  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Error interno: " + err.message });
  }
}

// ══════════════════════════════════════════════════════
// BASE DE DATOS DE FÓRMULAS (ampliada y argumentada)
// ══════════════════════════════════════════════════════
function getFormulasDB(mat, tema) {
  const t = tema.toLowerCase();
  const DB = {
    fisica: [
      {
        keys: ["newton", "fuerza", "dinámica"],
        val: `📌 *1ª Ley — Inercia:* Todo cuerpo permanece en reposo o en MRU si la fuerza neta es cero. Establece el concepto de sistema inercial.\n\n📌 *2ª Ley — F = m·a*\n  • F: Fuerza resultante (Newton, N)\n  • m: Masa inercial (kilogramo, kg)\n  • a: Aceleración producida (m/s²)\n  ⚠️ Solo válida en marcos de referencia inerciales.\n\n📌 *3ª Ley — Acción y Reacción:* F_AB = −F_BA\n  Las fuerzas siempre aparecen en pares iguales y opuestos sobre cuerpos distintos.\n\n📌 *Peso:* W = m·g  (g = 9.8 m/s² en superficie terrestre)\n📌 *Momento lineal:* p = m·v  →  F = Δp/Δt (forma más general de la 2ª Ley)`
      },
      {
        keys: ["cinemat", "velocidad", "aceleraci", "movimiento"],
        val: `📌 *Velocidad media:* v̄ = Δx/Δt\n📌 *Aceleración media:* ā = Δv/Δt\n\n📌 *Ecuaciones del MUA (Movimiento Uniformemente Acelerado):*\n  1. v = v₀ + at\n  2. x = v₀t + ½at²\n  3. v² = v₀² + 2ax\n  4. x = ½(v₀+v)·t\n\n📌 *Caída libre:* a = g = 9.8 m/s² (sin rozamiento)\n  • h = ½gt²   |   v = gt   |   v² = 2gh\n\n⚠️ En el Sistema Internacional: [x]=m, [t]=s, [v]=m/s, [a]=m/s²\n⚠️ v₀ = velocidad inicial; si parte del reposo v₀ = 0`
      },
      {
        keys: ["energ", "trabajo", "potencia"],
        val: `📌 *Trabajo mecánico:* W = F·d·cosθ  (Joules, J)\n  θ es el ángulo entre F y el desplazamiento.\n  Si θ=90°, W=0 (fuerza perpendicular no hace trabajo).\n\n📌 *Energía cinética:* Ec = ½mv²\n📌 *Energía potencial gravitatoria:* Ep = mgh\n📌 *Potencia:* P = W/t = F·v  (Watts, W)\n\n📌 *Teorema trabajo-energía:* W_neto = ΔEc\n📌 *Conservación de energía mecánica:*\n  Ec₁ + Ep₁ = Ec₂ + Ep₂  (sin rozamiento)\n\n⚠️ 1 kWh = 3.6×10⁶ J  |  1 cal = 4.186 J`
      },
      {
        keys: ["termodinámica", "termodin", "calor", "temperatura", "gas"],
        val: `📌 *0ª Ley:* Si A≡B y B≡C en equilibrio térmico → A≡C (define temperatura)\n📌 *1ª Ley:* ΔU = Q − W  (conservación de energía)\n  • ΔU: cambio en energía interna\n  • Q > 0: calor absorbido por el sistema\n  • W > 0: trabajo realizado por el sistema\n\n📌 *2ª Ley:* El calor fluye espontáneamente del cuerpo caliente al frío.\n  Entropía del universo siempre aumenta (ΔS_universo ≥ 0)\n\n📌 *Ley del gas ideal:* PV = nRT\n  R = 8.314 J/(mol·K)  |  T en Kelvin = °C + 273.15\n\n📌 *Calor sensible:* Q = m·c·ΔT\n📌 *Eficiencia Carnot:* η = 1 − Tc/Th  (máx. teórico)`
      },
      {
        keys: ["electr", "corriente", "volt", "ohm", "magnetismo"],
        val: `📌 *Ley de Ohm:* V = I·R\n  V: tensión (Volts) | I: corriente (Amperes) | R: resistencia (Ohms Ω)\n\n📌 *Ley de Coulomb:* F = k·q₁q₂/r²\n  k = 8.99×10⁹ N·m²/C²\n\n📌 *Campo eléctrico:* E = F/q = k·Q/r²  (N/C)\n📌 *Potencial eléctrico:* V = k·Q/r  (Volts)\n\n📌 *Potencia eléctrica:* P = V·I = I²R = V²/R\n📌 *Energía eléctrica:* E = P·t  (Joules o kWh)\n\n📌 *Resistencias en serie:* R_T = R₁+R₂+...\n📌 *Resistencias en paralelo:* 1/R_T = 1/R₁+1/R₂+...\n\n⚠️ Ley de Kirchhoff:\n  • Nodos: ΣI_entrada = ΣI_salida\n  • Mallas: ΣV = 0`
      },
      {
        keys: ["onda", "sonido", "luz", "frecuencia", "optica", "óptica"],
        val: `📌 *Relación fundamental:* v = λ·f\n  v: velocidad (m/s) | λ: longitud de onda (m) | f: frecuencia (Hz)\n\n📌 *Período:* T = 1/f  (segundos)\n📌 *Intensidad sonora (dB):* L = 10·log₁₀(I/I₀)  con I₀ = 10⁻¹² W/m²\n\n📌 *Refracción — Ley de Snell:* n₁·sinθ₁ = n₂·sinθ₂\n📌 *Índice de refracción:* n = c/v  (c = 3×10⁸ m/s en vacío)\n\n📌 *Efecto Doppler:* f' = f·(v±v_obs)/(v∓v_fuente)\n\n⚠️ Velocidad sonido en aire ≈ 343 m/s a 20°C\n⚠️ Luz visible: λ entre 380 nm (violeta) y 750 nm (rojo)`
      }
    ],
    quimica: [
      {
        keys: ["acido", "base", "ph", "neutraliz", "tampón", "buffer"],
        val: `📌 *Definición de Arrhenius:*\n  Ácido: libera H⁺  |  Base: libera OH⁻\n\n📌 *Definición de Brønsted-Lowry:*\n  Ácido: dona protón (H⁺)  |  Base: acepta protón\n\n📌 *Escala de pH:* pH = −log₁₀[H⁺]\n  Ácido: pH < 7  |  Neutro: pH = 7  |  Base: pH > 7\n\n📌 *Relaciones clave:*\n  pH + pOH = 14  (a 25°C)\n  Kw = [H⁺][OH⁻] = 10⁻¹⁴  (producto iónico del agua)\n  Ka (ac. débil): Ka = [H⁺][A⁻]/[HA]\n\n📌 *Ácidos fuertes* (ionización completa): HCl, HBr, HI, HNO₃, H₂SO₄, HClO₄\n📌 *Bases fuertes:* NaOH, KOH, Ca(OH)₂, Ba(OH)₂\n\n⚠️ En ácidos débiles: pH = ½(pKa − log C)\n⚠️ Ec. de Henderson-Hasselbalch: pH = pKa + log([A⁻]/[HA])`
      },
      {
        keys: ["mol", "estequio", "rendimiento", "masa molar"],
        val: `📌 *Mol:* n = m / M\n  n: moles | m: masa (g) | M: masa molar (g/mol)\n\n📌 *Número de Avogadro:* Nₐ = 6.022×10²³ partículas/mol\n📌 *Gas ideal:* PV = nRT  (R = 0.08206 L·atm/mol·K)\n\n📌 *Concentración molar:* C = n/V  (mol/L o M)\n📌 *Dilución:* C₁V₁ = C₂V₂\n\n📌 *Rendimiento:* η = (masa real / masa teórica) × 100%\n📌 *Factor de conversión:* mol A → mol B (usando coeficientes estequiométricos)\n\n⚠️ Pasos estequiométricos:\n  1. Balancear la ecuación\n  2. Convertir a moles\n  3. Usar relación molar\n  4. Convertir a unidades pedidas`
      },
      {
        keys: ["enlace", "iónico", "covalente", "electronega", "quimica", "química"],
        val: `📌 *Electronegatividad (Pauling):*\n  F(4.0) > O(3.5) > N(3.0) > Cl(3.2) > Br(2.8) > C(2.5)\n\n📌 *Tipo de enlace según ΔEN:*\n  ΔEN < 0.4 → Covalente no polar\n  0.4 ≤ ΔEN ≤ 1.7 → Covalente polar\n  ΔEN > 1.7 → Iónico\n\n📌 *Regla del octeto:* Los átomos tienden a completar 8 e⁻ en su capa de valencia.\n  Excepción: H (2 e⁻), Be (4 e⁻), B (6 e⁻), compuestos hipervalentes de P, S.\n\n📌 *Geometría molecular — VSEPR:*\n  2 pares: lineal (180°)\n  3 pares: trigonal plana (120°)\n  4 pares: tetraédrica (109.5°)\n  4 pares (1 libre): piramidal (107°)\n  4 pares (2 libres): angular (104.5°) → H₂O`
      },
      {
        keys: ["oxida", "redox", "electron", "reducción"],
        val: `📌 *Reglas mnemotécnicas:*\n  OIL RIG: Oxidation Is Loss / Reduction Is Gain (electrones)\n  LEO dice GER: Pierde Electrones Oxida / Gana Electrones Reduce\n\n📌 *Número de oxidación — reglas principales:*\n  O en compuestos = −2 (excepto peróxidos: −1)\n  H en compuestos = +1 (excepto hidruros metálicos: −1)\n  Suma en compuesto neutro = 0\n  Suma en ion = carga del ion\n\n📌 *Celda galvánica vs electrolítica:*\n  Galvánica: ΔG < 0 (espontánea, genera electricidad — pilas)\n  Electrolítica: ΔG > 0 (no espontánea, consume electricidad — electrólisis)\n\n📌 *Potencial estándar de celda:* E°celda = E°cátodo − E°ánodo\n  Si E°celda > 0 → reacción espontánea`
      }
    ],
    matematicas: [
      {
        keys: ["derivada", "diferencial", "derivación"],
        val: `📌 *Definición:* f'(x) = lím[h→0] [f(x+h)−f(x)]/h\n  Interpretación geométrica: pendiente de la recta tangente.\n  Interpretación física: tasa instantánea de cambio.\n\n📌 *Reglas fundamentales:*\n  (c)' = 0           (constante)\n  (xⁿ)' = n·xⁿ⁻¹   (potencia)\n  (eˣ)' = eˣ        (exponencial natural)\n  (ln x)' = 1/x\n  (sin x)' = cos x\n  (cos x)' = −sin x\n  (tan x)' = sec²x\n\n📌 *Reglas de operación:*\n  (f±g)' = f'±g'\n  (f·g)' = f'g + fg'          (producto)\n  (f/g)' = (f'g−fg')/g²      (cociente)\n  [f(g(x))]' = f'(g(x))·g'(x) (cadena)\n\n⚠️ Criterio de puntos críticos: f'(x)=0 o no existe\n⚠️ f''(x)>0 → mínimo local | f''(x)<0 → máximo local`
      },
      {
        keys: ["integral", "integra", "antideriva", "primitiva"],
        val: `📌 *Definición:* ∫f(x)dx = F(x)+C  donde F'(x) = f(x)\n  Teorema Fundamental del Cálculo: ∫ₐᵇf(x)dx = F(b)−F(a)\n\n📌 *Integrales básicas:*\n  ∫xⁿdx = xⁿ⁺¹/(n+1) + C   (n≠−1)\n  ∫(1/x)dx = ln|x| + C\n  ∫eˣdx = eˣ + C\n  ∫aˣdx = aˣ/ln(a) + C\n  ∫sin x dx = −cos x + C\n  ∫cos x dx = sin x + C\n  ∫sec²x dx = tan x + C\n\n📌 *Técnicas de integración:*\n  • Sustitución: u = g(x) → ∫f(g)g'dx = ∫f(u)du\n  • Por partes: ∫u dv = uv − ∫v du  (LIATE: Logarítmica, Inversa, Algebráica, Trigonométrica, Exponencial)\n\n⚠️ No olvides +C en integrales indefinidas\n⚠️ Interpretación: área bajo la curva entre a y b`
      },
      {
        keys: ["trigono", "seno", "coseno", "tangente", "trigo"],
        val: `📌 *Identidades pitagóricas:*\n  sin²θ + cos²θ = 1\n  1 + tan²θ = sec²θ\n  1 + cot²θ = csc²θ\n\n📌 *Ángulos especiales:*\n  θ=30°: sin=1/2, cos=√3/2, tan=1/√3\n  θ=45°: sin=cos=√2/2, tan=1\n  θ=60°: sin=√3/2, cos=1/2, tan=√3\n\n📌 *Fórmulas de suma y resta:*\n  sin(A±B) = sinA·cosB ± cosA·sinB\n  cos(A±B) = cosA·cosB ∓ sinA·sinB\n  tan(A±B) = (tanA±tanB)/(1∓tanA·tanB)\n\n📌 *Leyes para triángulos oblicuos:*\n  Senos: a/sinA = b/sinB = c/sinC\n  Cosenos: c² = a²+b²−2ab·cosC\n\n⚠️ Cuadrantes — signo positivo:\n  QI: todos | QII: sin | QIII: tan | QIV: cos`
      },
      {
        keys: ["probabilidad", "estadíst", "estadist", "distribución", "distribucion"],
        val: `📌 *Reglas de probabilidad:*\n  0 ≤ P(A) ≤ 1\n  P(A) + P(Aᶜ) = 1\n  P(A∪B) = P(A)+P(B)−P(A∩B)\n  P(A∩B) = P(A)·P(B|A)  [Regla del producto]\n  P(A|B) = P(A∩B)/P(B)  [Probabilidad condicional]\n\n📌 *Combinatoria:*\n  Permutaciones: P(n,r) = n!/(n−r)!\n  Combinaciones: C(n,r) = n!/[r!(n−r)!]\n\n📌 *Distribución Normal N(μ,σ):*\n  Regla 68-95-99.7:\n  68% datos en [μ−σ, μ+σ]\n  95% datos en [μ−2σ, μ+2σ]\n  99.7% datos en [μ−3σ, μ+3σ]\n\n📌 *Estadística descriptiva:*\n  Media: x̄ = Σxᵢ/n\n  Varianza: s² = Σ(xᵢ−x̄)²/(n−1)\n  Desv. estándar: s = √s²`
      },
      {
        keys: ["límite", "limite", "continuid", "l'hopital", "lopital"],
        val: `📌 *Propiedades de límites:*\n  lím[f±g] = lím f ± lím g\n  lím[f·g] = lím f · lím g\n  lím[f/g] = lím f / lím g  (si lím g ≠ 0)\n\n📌 *Límites fundamentales:*\n  lím(x→0) sin(x)/x = 1\n  lím(x→∞) (1+1/n)ⁿ = e ≈ 2.718\n  lím(x→0) (eˣ−1)/x = 1\n\n📌 *Regla de L'Hôpital:*\n  Si lím f/g = 0/0 ó ∞/∞ →  lím f/g = lím f'/g'\n\n📌 *Continuidad en x=a:*\n  1) f(a) existe\n  2) lím(x→a) f(x) existe\n  3) lím(x→a) f(x) = f(a)\n\n⚠️ Discontinuidad evitable: el límite existe pero ≠ f(a)\n⚠️ Discontinuidad esencial: el límite no existe`
      }
    ],
    biologia: [
      {
        keys: ["célula", "celula", "organelo", "membrana", "mitosis"],
        val: `📌 *Tipos celulares:*\n  Procariota: sin núcleo definido, sin orgánulos membranosos (bacterias, arqueas). Tamaño: 1-10 μm.\n  Eucariota: núcleo con membrana nuclear, orgánulos especializados (animales, plantas, hongos). 10-100 μm.\n\n📌 *Membrana plasmática:* Modelo de mosaico fluido (Singer-Nicolson, 1972)\n  Bicapa fosfolipídica + colesterol + proteínas integrales y periféricas\n  Función: selectividad, comunicación, transporte\n\n📌 *Orgánulos clave y su función:*\n  Mitocondria → respiración celular (ATP): C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O + 36-38 ATP\n  Ribosoma → síntesis proteica (traducción)\n  R. endoplásmico rugoso → síntesis y transporte de proteínas\n  R. endoplásmico liso → síntesis de lípidos, detoxificación\n  Ap. Golgi → modificación y empaquetado de proteínas\n  Lisosoma → digestión intracelular\n  Cloroplasto (plantas) → fotosíntesis\n\n📌 *Ciclo celular:* G1 → S (replicación ADN) → G2 → M (mitosis)\n  Mitosis: PROFASE → METAFASE → ANAFASE → TELOFASE → CITOCINESIS`
      },
      {
        keys: ["fotosíntesis", "fotosintesis", "clorofila", "glucosa", "planta"],
        val: `📌 *Ecuación global:*\n  6CO₂ + 6H₂O + energía lumínica → C₆H₁₂O₆ + 6O₂\n\n📌 *Fase luminosa (reacciones de Hill — en tilacoides):*\n  • Absorción de luz por clorofila a y b\n  • Fotólisis del agua: 2H₂O → 4H⁺ + 4e⁻ + O₂↑\n  • Producción: ATP (fotofosforilación) + NADPH\n  • Fotosistemas: PSII (680 nm) → PSI (700 nm)\n\n📌 *Ciclo de Calvin (fase oscura — en estroma):*\n  Fijación: CO₂ + RuBP → 2 PGA (RuBisCO)\n  Reducción: PGA + ATP + NADPH → G3P\n  Regeneración: G3P → RuBP (gasta ATP)\n  Rendimiento: 3 CO₂ → 1 G3P (=½ glucosa)\n\n📌 *Pigmentos:* Clorofila a (azul-rojo), clorofila b (azul-naranja), carotenoides\n⚠️ La clorofila NO absorbe eficientemente luz verde → la refleja (color verde)`
      },
      {
        keys: ["genética", "genetica", "adn", "arn", "gen", "herencia", "mendel", "mutación"],
        val: `📌 *Dogma central de la biología molecular:*\n  ADN → (Transcripción) → ARNm → (Traducción) → Proteína\n\n📌 *Estructura del ADN (Watson-Crick, 1953):*\n  Doble hélice antiparalela\n  Bases: A−T (2 puentes H) | G−C (3 puentes H)\n  En ARN: Uracilo (U) reemplaza a Timina (T)\n\n📌 *Código genético:*\n  Codón = 3 bases de ARNm = 1 aminoácido\n  64 codones totales | 61 codifican AA | 3 son de STOP\n  Es universal, no solapado, degenerado\n\n📌 *Leyes de Mendel:*\n  1ª — Segregación: los alelos se separan en la meiosis\n  2ª — Distribución independiente: genes en cromosomas distintos segregan independientemente\n\n📌 *Mutaciones:*\n  Génicas: sustitución, inserción, deleción de bases\n  Cromosómicas: deleción, inversión, translocación, duplicación\n  Nucleotídicas: silenciosas, de sentido erróneo, sin sentido`
      },
      {
        keys: ["ecología", "ecologia", "ecosistema", "cadena", "bioma", "población"],
        val: `📌 *Niveles de organización ecológica:*\n  Gen → Organismo → Población → Comunidad → Ecosistema → Bioma → Biosfera\n\n📌 *Flujo de energía — Regla del 10%:*\n  Solo el 10% de la energía se transfiere entre niveles tróficos\n  Productores (plantas) → Herbívoros → Carnívoros → Omnívoros → Descomponedores\n\n📌 *Ciclos biogeoquímicos:*\n  Carbono: CO₂ → fotosíntesis → glucosa → respiración → CO₂\n  Nitrógeno: N₂ → fijación → NH₃ → nitrificación → NO₃⁻ → plantas\n  Agua: evaporación → condensación → precipitación → escorrentía\n\n📌 *Dinámica de poblaciones:*\n  Crecimiento exponencial: N(t) = N₀·eʳᵗ\n  Crecimiento logístico: dN/dt = rN(1−N/K)  [K = capacidad de carga]`
      }
    ],
    salud: [
      {
        keys: ["hipertensión", "hipertension", "presión", "presion", "cardiovascular"],
        val: `📌 *Clasificación JNC 8 / AHA 2017 (mmHg):*\n  Normal: <120/<80\n  Elevada: 120-129/<80\n  HTA Estadio 1: 130-139 / 80-89\n  HTA Estadio 2: ≥140 / ≥90\n  Crisis hipertensiva: >180/>120 (EMERGENCIA)\n\n📌 *Fisiopatología:* PA = GC × RVP\n  GC: gasto cardíaco (L/min) | RVP: resistencia vascular periférica\n  Sistema RAAS (renina-angiotensina-aldosterona) regula PA a largo plazo\n\n📌 *Fármacos de primera línea:*\n  IECA (ej. enalapril): bloquean conversión Ang I → Ang II\n  ARA II (ej. losartán): bloquean receptor AT1\n  Ca-antagonistas (ej. amlodipino): vasodilatación\n  Diuréticos tiazídicos (ej. hidroclorotiazida): ↓ volumen plasmático\n\n📌 *Reducción de PA por intervención no farmacológica:*\n  Dieta DASH: −11 mmHg sistólica\n  Reducción sal (<5g/día): −5.1 mmHg\n  Actividad física (30 min/día): −4.9 mmHg\n  Pérdida de peso (−5 kg): −4.4 mmHg`
      },
      {
        keys: ["diabetes", "glucosa", "insulina", "glucemia"],
        val: `📌 *Criterios diagnósticos ADA 2024:*\n  Glucosa ayunas ≥126 mg/dL (en 2 ocasiones)\n  Glucosa 2h post-carga ≥200 mg/dL (PTOG 75g)\n  HbA1c ≥6.5%\n  Glucosa aleatoria ≥200 mg/dL + síntomas\n\n📌 *Diferencias DM1 vs DM2:*\n  DM1: destrucción autoinmune células β-pancreáticas, insulinopenia absoluta\n  DM2: resistencia a insulina + déficit relativo de secreción, asociada a obesidad\n\n📌 *Fisiopatología DM2 — "Octeto ominoso" (DeFronzo):*\n  ↓ secreción insulínica (β-célula) + ↑ resistencia insulínica (músculo, hígado, grasa)\n  + ↑ glucagón + ↓ efecto incretina + ↑ reabsorción renal glucosa + neuroinflamación\n\n📌 *Metas terapéuticas:*\n  HbA1c < 7% (adulto general) | <6.5% (jóvenes, recién dx)\n  Glucosa ayunas: 80-130 mg/dL | 2h postprandial: <180 mg/dL\n  PA: <130/80 mmHg | LDL: <70 mg/dL (con ECV)`
      },
      {
        keys: ["sistema inmune", "inmun", "anticuerpo", "linfocito", "vacuna"],
        val: `📌 *Líneas de defensa:*\n  1ª: barreras físicas (piel, mucosas, pH gástrico, cilios)\n  2ª: inmunidad innata (neutrófilos, macrófagos, NK, complemento, inflamación)\n  3ª: inmunidad adaptativa (linfocitos B y T, específica, con memoria)\n\n📌 *Linfocitos T — subtipos:*\n  Th1: activan macrófagos → infecciones intracelulares\n  Th2: activan linfocitos B → parásitos extracelulares\n  Th17: inflamación, bacterias extracelulares\n  Treg: supresión inmune, tolerancia\n  Tc (CD8+): citotoxicidad, destruyen células infectadas\n\n📌 *Inmunoglobulinas:*\n  IgG (75%): memoria, cruza placenta, activa complemento\n  IgA: protege mucosas (saliva, lágrimas, leche materna)\n  IgM: respuesta primaria, activa complemento eficientemente\n  IgE: reacciones alérgicas, parásitos\n  IgD: activación de linfocitos B naïve\n\n📌 *Vacunas — tipos:*\n  Vivas atenuadas: MMR, varicela (alta inmunogenicidad)\n  Inactivadas: influenza, hepatitis A\n  Subunitarias: HBV, VPH\n  ARNm: COVID-19 (Pfizer, Moderna)`
      },
      {
        keys: ["nutrición", "nutricion", "vitamina", "mineral", "dieta", "macronutriente"],
        val: `📌 *Macronutrientes y valor calórico:*\n  Carbohidratos: 4 kcal/g  (50-60% de la dieta)\n  Proteínas: 4 kcal/g  (10-15% de la dieta)\n  Grasas: 9 kcal/g  (25-35% de la dieta)\n  Alcohol: 7 kcal/g  (no esencial)\n\n📌 *Vitaminas liposolubles (A, D, E, K):*\n  Vit. D: síntesis ósea, inmunomodulación; déficit → raquitismo/osteomalacia\n  Vit. K: coagulación (factores II, VII, IX, X)\n  Vit. A: visión, epitelio; déficit → ceguera nocturna\n\n📌 *Vitaminas hidrosolubles (C y complejo B):*\n  Vit. C: antioxidante, síntesis colágeno; déficit → escorbuto\n  B12: eritropoyesis, mielinización; déficit → anemia megaloblástica\n  Ácido fólico: síntesis ADN; déficit en embarazo → defectos tubo neural\n\n📌 *IMC y clasificación OMS:*\n  <18.5: bajo peso | 18.5-24.9: normal | 25-29.9: sobrepeso\n  30-34.9: obesidad I | 35-39.9: obesidad II | ≥40: obesidad III (mórbida)`
      }
    ]
  };

  const materiaDB = DB[mat] || [];
  const t = tema.toLowerCase();
  for (const entry of materiaDB) {
    if (entry.keys.some(k => t.includes(k))) return entry.val;
  }
  return null;
}

// ══════════════════════════════════════════════════════
// EJERCICIOS RESUELTOS (ampliados y bien argumentados)
// ══════════════════════════════════════════════════════
function getEjercicioDB(mat, tema, oraciones) {
  const t = tema.toLowerCase();
  const EJ = {
    fisica: [
      {
        keys: ["newton", "fuerza", "dinámica"],
        txt: `*Problema:* Un bloque de 8 kg se encuentra sobre una superficie horizontal con coeficiente de rozamiento cinético μk=0.3. Se aplica una fuerza horizontal de 50 N. ¿Cuál es la aceleración del bloque? (g=9.8 m/s²)\n\n*Solución paso a paso:*\n1️⃣ Calcular el peso: W = mg = 8×9.8 = 78.4 N\n2️⃣ Fuerza normal: N = W = 78.4 N (superficie horizontal)\n3️⃣ Fuerza de rozamiento: fr = μk×N = 0.3×78.4 = 23.52 N\n4️⃣ Fuerza neta: F_neta = 50 − 23.52 = 26.48 N\n5️⃣ Aplicar 2ª Ley: a = F_neta/m = 26.48/8\n✅ *a = 3.31 m/s²*\n\n💡 Sin rozamiento sería 6.25 m/s² — el rozamiento redujo la aceleración casi a la mitad.`
      },
      {
        keys: ["cinemat", "velocidad", "movimiento"],
        txt: `*Problema:* Un proyectil es lanzado horizontalmente desde una altura de 80 m con velocidad inicial de 30 m/s. ¿Cuánto tarda en llegar al suelo y a qué distancia horizontal cae? (g=9.8 m/s²)\n\n*Solución:*\n1️⃣ Movimiento vertical (caída libre):\n   h = ½gt²  →  t = √(2h/g) = √(160/9.8) = √16.33\n   *t = 4.04 s*\n2️⃣ Movimiento horizontal (MRU):\n   x = v₀×t = 30×4.04\n   *x = 121.2 m*\n3️⃣ Velocidad al impacto:\n   vy = g×t = 9.8×4.04 = 39.6 m/s\n   v_total = √(vx²+vy²) = √(900+1568) = *49.7 m/s*\n\n✅ Cae a los 4.04 s y a 121.2 m del punto de lanzamiento.`
      },
      {
        keys: ["energ", "trabajo"],
        txt: `*Problema:* Un automóvil de 1200 kg sube una pendiente de 30° durante 200 m con velocidad constante de 20 m/s. ¿Cuánto trabajo realiza el motor? (g=9.8 m/s², sin rozamiento)\n\n*Solución:*\n1️⃣ Componente del peso en la dirección de movimiento:\n   W_paralelo = m·g·sin30° = 1200×9.8×0.5 = 5880 N\n2️⃣ Para velocidad constante: F_motor = W_paralelo = 5880 N\n3️⃣ Trabajo del motor:\n   W = F×d = 5880×200 = *1,176,000 J = 1.176 MJ*\n4️⃣ Equivale a: ΔEp = mgh = 1200×9.8×(200×sin30°) = 1.176 MJ ✓\n\n✅ El motor realiza 1.176 MJ de trabajo — todo se convierte en energía potencial.`
      },
    ],
    quimica: [
      {
        keys: ["acido", "base", "ph", "neutraliz"],
        txt: `*Problema:* Se mezclan 50 mL de HCl 0.2 M con 30 mL de NaOH 0.3 M. ¿Cuál es el pH de la solución resultante?\n\n*Solución:*\n1️⃣ Moles de HCl: n(HCl) = 0.050 L × 0.2 mol/L = 0.010 mol\n2️⃣ Moles de NaOH: n(NaOH) = 0.030 L × 0.3 mol/L = 0.009 mol\n3️⃣ Reacción: HCl + NaOH → NaCl + H₂O\n   Exceso de HCl: 0.010 − 0.009 = 0.001 mol (ácido en exceso)\n4️⃣ Volumen total: 50 + 30 = 80 mL = 0.080 L\n5️⃣ [H⁺] = 0.001 mol / 0.080 L = 0.0125 M\n6️⃣ pH = −log(0.0125) = −log(1.25×10⁻²)\n   pH = 2 − log(1.25) = 2 − 0.097\n✅ *pH ≈ 1.90* (solución ácida, HCl en exceso)`
      },
      {
        keys: ["mol", "estequio", "rendimiento"],
        txt: `*Problema:* En la combustión de propano: C₃H₈ + 5O₂ → 3CO₂ + 4H₂O\n¿Cuántos gramos de CO₂ se producen al quemar 44 g de C₃H₈? ¿Y si el rendimiento es 85%?\n\n*Solución:*\n1️⃣ Masa molar C₃H₈ = 3(12)+8(1) = 44 g/mol\n   n(C₃H₈) = 44/44 = 1 mol\n2️⃣ Relación molar: 1 mol C₃H₈ → 3 mol CO₂\n   n(CO₂) teórico = 3 mol\n3️⃣ Masa CO₂: M(CO₂)=44 g/mol\n   m(CO₂) teórica = 3×44 = 132 g\n4️⃣ Con rendimiento 85%:\n   m(CO₂) real = 132×0.85 = *112.2 g*\n\n✅ Se producen 132 g (teórico) y 112.2 g con rendimiento del 85%.`
      }
    ],
    matematicas: [
      {
        keys: ["derivada", "diferencial"],
        txt: `*Problema:* Una empresa tiene costo total C(x) = 0.01x³ − 0.6x² + 15x + 100 (en miles de $). Halla el costo marginal mínimo y la cantidad que lo minimiza.\n\n*Solución:*\n1️⃣ Costo marginal: C'(x) = 0.03x² − 1.2x + 15\n2️⃣ Minimizar C'(x): C''(x) = 0.06x − 1.2 = 0\n   x = 1.2/0.06 = *20 unidades*\n3️⃣ Verificar mínimo: C'''(x)=0.06>0 → mínimo ✓\n4️⃣ Costo marginal mínimo:\n   C'(20) = 0.03(400) − 1.2(20) + 15\n           = 12 − 24 + 15 = *3 miles $/unidad*\n\n✅ El costo marginal es mínimo ($3000/ud) al producir 20 unidades.`
      },
      {
        keys: ["integral", "integra"],
        txt: `*Problema:* Calcula el área entre f(x)=x² y g(x)=x+2.\n\n*Solución:*\n1️⃣ Puntos de intersección: x² = x+2 → x²−x−2=0 → (x−2)(x+1)=0\n   x = −1 y x = 2\n2️⃣ En [−1,2]: g(x)≥f(x) (verifica con x=0: 2>0 ✓)\n3️⃣ Área = ∫₋₁² [g(x)−f(x)]dx = ∫₋₁² (x+2−x²)dx\n4️⃣ Antiderivada: x²/2 + 2x − x³/3\n5️⃣ Evaluar:\n   F(2)  = 2 + 4 − 8/3 = 6 − 2.667 = 3.333\n   F(−1) = 1/2 − 2 + 1/3 = −1.167\n   Área = 3.333 − (−1.167) = *4.5 u²*\n\n✅ El área encerrada entre las curvas es 4.5 unidades cuadradas.`
      },
      {
        keys: ["trigono", "seno", "coseno"],
        txt: `*Problema:* Un barco observa la cima de un faro con ángulo de elevación de 28°. Al acercarse 50 m, el ángulo es 46°. ¿Cuál es la altura del faro?\n\n*Solución (Ley de senos + triángulos):*\n1️⃣ Sea h la altura y d la distancia inicial al pie del faro.\n   tan(28°) = h/d  →  d = h/tan(28°) = h/0.5317\n   tan(46°) = h/(d−50) → d−50 = h/tan(46°) = h/1.0355\n2️⃣ Restando: d − (d−50) = h/0.5317 − h/1.0355\n   50 = h(1.881 − 0.966) = h(0.915)\n3️⃣ h = 50/0.915 = *54.6 m*\n\n✅ La altura del faro es aproximadamente 54.6 metros.`
      },
      {
        keys: ["probabilidad", "estadíst"],
        txt: `*Problema:* En un examen, las notas siguen N(μ=65, σ=12). ¿Qué % de estudiantes aprueba si la nota mínima es 50? ¿Cuántos en un grupo de 80?\n\n*Solución:*\n1️⃣ Estandarizar: Z = (X−μ)/σ = (50−65)/12 = −1.25\n2️⃣ P(X≥50) = P(Z≥−1.25) = 1 − P(Z<−1.25)\n   De tabla Z: P(Z<−1.25) = 0.1056\n   P(X≥50) = 1 − 0.1056 = *0.8944 = 89.44%*\n3️⃣ Estudiantes que aprueban: 80×0.8944 = *71.5 ≈ 72 estudiantes*\n\n✅ Aproximadamente 89.4% aprueba y en un grupo de 80, unos 72 estudiantes.`
      }
    ],
    biologia: [
      {
        keys: ["genética", "genetica", "herencia", "mendel"],
        txt: `*Problema:* Un hombre daltónico (X^d Y) se casa con una mujer de visión normal cuyo padre era daltónico (X^D X^d). Determina la probabilidad de hijos daltónicos y portadores.\n\n*Solución:*\n1️⃣ Genotipos parentales: X^d Y × X^D X^d\n2️⃣ Cuadro de Punnett:\n        X^D      X^d\n   X^d  X^D X^d  X^d X^d\n   Y    X^D Y    X^d Y\n3️⃣ Descendencia (probabilidades):\n   Hijas X^D X^d = 25% → portadoras (visión normal)\n   Hijas X^d X^d = 25% → DALTÓNICAS\n   Hijos X^D Y  = 25% → normales\n   Hijos X^d Y  = 25% → DALTÓNICOS\n4️⃣ Resumen:\n   50% de los HIJOS serán daltónicos\n   50% de las HIJAS serán portadoras\n   25% de TODA la descendencia será daltónica\n\n✅ La herencia ligada al cromosoma X explica la mayor prevalencia del daltonismo en varones.`
      },
      {
        keys: ["célula", "celula", "fotosíntesis", "fotosintesis"],
        txt: `*Problema:* Una planta produce 180 g de glucosa en un día. ¿Cuántos litros de CO₂ consumió y de O₂ liberó? (condiciones normales de T y P)\n\n*Solución:*\n1️⃣ Ecuación: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂\n2️⃣ Masa molar glucosa: 6(12)+12(1)+6(16) = 180 g/mol\n   Moles de glucosa: 180/180 = 1 mol\n3️⃣ Por estequiometría: 1 mol glucosa ↔ 6 mol CO₂ ↔ 6 mol O₂\n4️⃣ Volumen a condiciones normales (22.4 L/mol):\n   V(CO₂) = 6×22.4 = *134.4 litros consumidos*\n   V(O₂)  = 6×22.4 = *134.4 litros liberados*\n\n✅ Para producir 180g de glucosa se consumen y liberan 134.4 L de CO₂ y O₂ respectivamente.`
      }
    ],
    salud: [
      {
        keys: ["hipertensión", "hipertension", "presión"],
        txt: `*Caso clínico:* Hombre 58 años, PA 158/96 mmHg (promedio 3 mediciones en 2 semanas), IMC 29.5 kg/m², glucosa 108 mg/dL, fumador. ¿Diagnóstico, riesgo cardiovascular y conducta?\n\n*Análisis:*\n1️⃣ PA: 158/96 → HTA Estadio 2 (≥140/≥90) ✓\n2️⃣ Factores de riesgo CV adicionales:\n   • Edad ≥55 años (hombre)\n   • Tabaquismo activo\n   • Sobrepeso (IMC 29.5)\n   • Glucosa 108 mg/dL → prediabetes (100-125)\n   Total: ≥3 factores → Riesgo CV ALTO\n3️⃣ Conducta recomendada (ESH/ESC 2023):\n   • Iniciar tratamiento farmacológico inmediato\n   • Fármaco de 1ª línea: IECA o ARA II + Ca-antagonista\n   • Meta: PA <130/80 mmHg\n   • Cambios estilo de vida: dejar tabaco, ejercicio, dieta DASH\n   • Monitorear glucosa (riesgo DM2)\n\n✅ HTA Estadio 2 con riesgo CV alto. Requiere farmacoterapia + cambios de estilo de vida inmediatos.`
      },
      {
        keys: ["diabetes", "glucosa", "insulina"],
        txt: `*Caso clínico:* Mujer 52 años, IMC 31.2 kg/m², glucosa ayunas 138 mg/dL, HbA1c 7.8%, microalbuminuria positiva. ¿Diagnóstico, estadio y plan terapéutico?\n\n*Análisis:*\n1️⃣ Diagnóstico: Diabetes Mellitus tipo 2\n   Glucosa ≥126 ✓ | HbA1c ≥6.5% ✓ (criterios ADA 2024)\n2️⃣ Complicaciones: microalbuminuria → nefropatía diabética incipiente (estadio G1-A2)\n3️⃣ Plan terapéutico (ADA Standards 2024):\n   a) Fármaco 1ª línea: Metformina 500 mg c/12h (↑ progresivo)\n   b) Con microalbuminuria: IECA/ARA II (nefroprotección + cardioprotección)\n   c) Si HbA1c no llega a meta (<7%): agregar SGLT2i (ej. empagliflozina) — nefro y cardioprotector\n   d) Dieta: déficit calórico 500-750 kcal/día, baja en CHO refinados\n   e) Ejercicio: 150 min/semana aeróbico moderado\n4️⃣ Metas: HbA1c <7%, PA <130/80, LDL <70 mg/dL\n\n✅ DM2 con nefropatía incipiente. Metformina + IECA + modificación estilo de vida son pilares del tratamiento.`
      }
    ]
  };

  const materiaEJ = EJ[mat] || [];
  for (const entry of materiaEJ) {
    if (entry.keys.some(k => t.includes(k))) return entry.txt;
  }

  // Ejercicio de comprensión con texto real de Wikipedia
  const o1 = oraciones.find(o => o.length > 70 && o.length < 250) || "";
  const o2 = oraciones.find((o,i) => i > 3 && o.length > 70 && o.length < 250) || "";
  return `*Ejercicio de análisis y comprensión — "${tema}":*\n\n❓ *Pregunta 1:* ¿Cuál es el principio fundamental que define "${tema}"?\n✅ ${o1.slice(0, 240)}\n\n❓ *Pregunta 2:* ¿Cómo se aplica este concepto en un contexto real?\n✅ ${o2.slice(0, 240)}\n\n💡 Para ejercicios numéricos específicos de este tema, consulta tu libro de texto o pide un tema más preciso.`;
}

// ══════════════════════════════════════════════════════
// EJEMPLOS PRÁCTICOS (argumentados y con datos reales)
// ══════════════════════════════════════════════════════
function getEjemplosDB(mat, tema) {
  const t = tema.toLowerCase();
  const EX = {
    fisica: [
      {
        keys: ["newton", "fuerza"],
        txt: `🚗 *Airbags automotrices:* Aumentan el tiempo de colisión de ~5 ms a ~50 ms. Por la 2ª Ley (F=Δp/Δt), al aumentar Δt la fuerza se reduce ~10 veces, protegiendo órganos vitales.\n\n🚀 *Propulsión de cohetes:* El motor expulsa gases a 3000 m/s hacia atrás (3ª Ley). Un cohete Falcon 9 genera 7.6 MN de empuje usando ~3000 kg de combustible por segundo.\n\n⚽ *Biomecánica deportiva:* En el penalti, la fuerza aplicada al balón (~1500 N durante 8 ms) le imprime una aceleración de ~3000 m/s², alcanzando ~120 km/h.\n\n🏗️ *Ingeniería estructural:* Los puentes se diseñan considerando la 3ª Ley — cada apoyatura reacciona con una fuerza igual a la carga que soporta.`
      },
      {
        keys: ["energ", "trabajo"],
        txt: `💧 *Centrales hidroeléctricas:* La presa Itaipú (Brasil/Paraguay) aprovecha la Ep del agua para generar 14 GW — abastece el 17% de la demanda eléctrica brasileña y el 73% de la paraguaya.\n\n🎢 *Montaña rusa:* Diseñada con conservación de energía mecánica. La altura inicial (Ep máxima) determina la velocidad máxima en el punto más bajo: v = √(2gh).\n\n☀️ *Paneles fotovoltaicos:* Convierten energía lumínica en eléctrica con eficiencia del 15-22%. Un panel de 400W en 5h de sol pico genera 2 kWh — suficiente para 4h de aire acondicionado.\n\n🚂 *Frenado regenerativo (trenes/EVs):* Al frenar, el motor actúa como generador recuperando hasta el 70% de la Ec cinética y almacenándola en baterías.`
      },
      {
        keys: ["termodinámica", "termodin", "calor"],
        txt: `🚗 *Motor de combustión interna:* Opera según el ciclo Otto. La eficiencia teórica es η=1−1/r^(γ−1) (r: relación de compresión). Un motor con r=10 tiene η≈60%, pero en la práctica alcanza 25-35% por pérdidas.\n\n❄️ *Refrigeración:* Las heladeras y AC operan como máquinas de calor inversas (2ª Ley). El COP (coeficiente de rendimiento) de un refrigerador moderno es 3-5: extrae 3-5 veces más calor del que consume eléctricamente.\n\n🏭 *Centrales termoeléctricas:* Una planta de carbón convierte calor en electricidad con η≈35%. Las centrales de ciclo combinado (gas + vapor) alcanzan η≈60%, reduciendo emisiones.\n\n🍳 *Cocción de alimentos:* La inducción (η≈90%) es más eficiente que el gas (η≈40%) porque transfiere calor directamente al recipiente sin calentar el aire circundante.`
      }
    ],
    quimica: [
      {
        keys: ["acido", "base", "ph"],
        txt: `🦷 *Caries dental:* Las bacterias S. mutans producen ácido láctico (pH<5.5), disolviendo la hidroxiapatita del esmalte. Los fluoruros forman fluorapatita más resistente a pH 4.5.\n\n🌧️ *Lluvia ácida:* SO₂ y NOₓ de centrales térmicas se oxidan en la atmósfera → H₂SO₄ y HNO₃. El pH de la lluvia normal es 5.6 (CO₂); la lluvia ácida puede llegar a pH 4.0-4.5, dañando ecosistemas acuáticos.\n\n🩸 *Tampón bicarbonato en sangre:* H₂CO₃ ⇌ H⁺ + HCO₃⁻ mantiene el pH sanguíneo en 7.35-7.45. Una desviación de ±0.4 unidades puede ser fatal (acidosis/alcalosis). Los riñones regulan [HCO₃⁻].\n\n🧴 *Cosmética:* Los champús tienen pH 4.5-5.5 para mantener el pH del cuero cabelludo (4.5-5.5) y evitar el esponjamiento de la cutícula del cabello (que ocurre en pH alcalino).`
      },
      {
        keys: ["reacción", "reaccion", "combustión", "combustion", "quimica", "química"],
        txt: `⚡ *Pilas de hidrógeno:* 2H₂ + O₂ → 2H₂O + energía. Eficiencia del 60-70%, produciendo solo agua como residuo. Toyota Mirai recorre 650 km con un tanque de 5 kg H₂.\n\n🍞 *Fermentación alcohólica:* C₆H₁₂O₆ → 2C₂H₅OH + 2CO₂. Las levaduras (Saccharomyces cerevisiae) la realizan en ausencia de O₂. Base de panadería, cervecería y vinicultura desde hace 7000 años.\n\n💊 *Síntesis farmacéutica:* El ibuprofeno (C₁₃H₁₈O₂) se sintetiza industrialmente en 3 pasos a partir del isobutilbenceno. La estereoquímica es crítica: el S-ibuprofeno es 160× más activo que el R.\n\n🔋 *Baterías de litio:* LiCoO₂ + C ⇌ LiₓC + Li₁₋ₓCoO₂. Energía específica: 150-265 Wh/kg. Las baterías de estado sólido (en desarrollo) prometen >500 Wh/kg para vehículos eléctricos.`
      }
    ],
    matematicas: [
      {
        keys: ["derivada", "diferencial"],
        txt: `💹 *Análisis financiero:* La derivada del precio de una opción respecto al precio subyacente (Delta, Δ) determina la cobertura de riesgo. Black-Scholes usa derivadas parciales para valorar opciones financieras (Premio Nobel Economía 1997).\n\n🏥 *Epidemiología:* dI/dt = β·S·I − γ·I (modelo SIR). La derivada del número de infectados determina si la epidemia crece (dI/dt>0) o decrece. R₀ = β/γ: si >1, hay epidemia.\n\n🚗 *Control de trayectoria (Tesla Autopilot):* El sistema calcula la curvatura κ = |y''|/(1+y'²)^(3/2) (2da derivada) de la carretera para ajustar la dirección en tiempo real.\n\n🌡️ *Ley de enfriamiento de Newton:* dT/dt = −k(T−T_amb). La solución es T(t)=T_amb+(T₀−T_amb)e^(−kt). Un forense usa esta ecuación para estimar la hora de muerte.`
      },
      {
        keys: ["integral", "integra"],
        txt: `🏗️ *Ingeniería civil:* El cálculo de momentos de inercia (I = ∫y²dA) determina la rigidez de vigas y columnas. El puente Golden Gate soporta 18,000 toneladas gracias a cálculos integrales precisos.\n\n💊 *Farmacocinética:* El AUC (Área Bajo la Curva concentración-tiempo = ∫C(t)dt) mide la exposición total del organismo a un fármaco. Determina biodisponibilidad y dosificación.\n\n⚡ *Electricidad:* La carga almacenada en un capacitor es Q = ∫I(t)dt. Los capacitores de supercondensadores (hasta 500 F) usan este principio para el arranque de buses eléctricos.\n\n🌊 *Oceanografía:* El volumen de corrientes oceánicas se calcula integrando el campo vectorial de velocidades. La corriente del Golfo transporta ∫∫v·dA ≈ 30×10⁶ m³/s (30 Sverdrup).`
      },
      {
        keys: ["probabilidad", "estadíst", "estadist"],
        txt: `🧬 *Genética de poblaciones:* El equilibrio Hardy-Weinberg: p²+2pq+q²=1. Si la frecuencia del gen recesivo es 1%, entonces q=0.01, q²=0.0001 (1/10000 individuos enfermos). Usado para predecir prevalencia de enfermedades genéticas.\n\n📡 *Comunicaciones digitales:* Los códigos de corrección de errores (Hamming, Reed-Solomon) usan probabilidad combinatoria. Tu código QR sigue corrigiendo datos aunque el 30% esté dañado.\n\n🎯 *Control de calidad industrial:* El gráfico de control de Shewhart usa ±3σ para detectar fallas. Si el proceso está bajo control, la probabilidad de falsa alarma es solo 0.27% (Regla 99.73%).\n\n🤖 *Machine Learning:* La regresión logística, las redes bayesianas y los algoritmos de recomendación de Netflix y Spotify se basan en teorema de Bayes: P(A|B) = P(B|A)·P(A)/P(B).`
      }
    ],
    biologia: [
      {
        keys: ["célula", "celula"],
        txt: `🧬 *Terapia CAR-T contra el cáncer:* Se modifican genéticamente los linfocitos T del paciente para expresar receptores que reconocen células cancerosas. La tasa de remisión en leucemia linfoblástica aguda supera el 80%.\n\n💉 *Células madre (stem cells):* Las células madre pluripotentes pueden diferenciarse en cualquier tipo celular. En 2023, un paciente diabético tipo 1 fue tratado con células β-pancreáticas derivadas de células madre, produciendo insulina durante >1 año.\n\n🌱 *Agricultura celular:* La carne cultivada (Mark Post, 2013) se produce a partir de células musculares bovinas en biorreactores. No requiere sacrificio animal y reduciría emisiones de GEI agropecuarias en un 92%.\n\n🔬 *Diagnóstico molecular:* La PCR (Reacción en Cadena de la Polimerasa) amplifica fragmentos de ADN celular millones de veces en pocas horas. Base del diagnóstico de COVID-19, VIH, cáncer y pruebas de paternidad.`
      },
      {
        keys: ["genética", "genetica", "adn"],
        txt: `✂️ *CRISPR-Cas9 (Premio Nobel 2020):* La enzima Cas9 actúa como "tijeras moleculares" guiadas por ARN para editar secuencias de ADN específicas. En 2023 se aprobó la primera terapia CRISPR (Casgevy) para anemia falciforme.\n\n🌽 *OGM y seguridad alimentaria:* El arroz dorado tiene el gen de la betacarotenogénesis insertado; podría prevenir la deficiencia de vitamina A que afecta a 250 millones de personas en países en desarrollo.\n\n🧬 *Genómica de poblaciones:* El Proyecto Genoma Humano (2003) secuenció los 3.2 mil millones de pares de bases por $2.7 mil millones. Hoy cuesta <$1000 secuenciar un genoma completo y tarda 24h.\n\n👮 *Forense:* La técnica STR (Short Tandem Repeats) analiza 20 regiones del ADN para identificar personas con probabilidad de 1 en 10¹⁸ de error — más confiable que las huellas dactilares.`
      }
    ],
    salud: [
      {
        keys: ["hipertensión", "hipertension", "presión"],
        txt: `💊 *Adherencia terapéutica:* Solo el 50% de los hipertensos adheridos logran control de PA (OMS 2022). La falta de adherencia causa 10.5 millones de muertes cardiovasculares/año a nivel mundial.\n\n🧂 *Impacto de la reducción de sal:* El estudio INTERSALT (32 países, 10,000 personas) demostró que reducir 6g/día de sal reduce la PA sistólica 3.5 mmHg — parecería poco, pero en la población reduce infartos en 14% y accidentes cerebrovasculares en 20%.\n\n🏃 *Ejercicio como antihipertensivo:* El metaanálisis de Hegde et al. (2023, 391 estudios, 39,742 pacientes) demostró que el ejercicio aeróbico reduce PA sistólica −4.49 mmHg y PA diastólica −2.53 mmHg, comparable a algunos fármacos.\n\n📱 *Telemedicina y monitoreo:* Los tensiómetros Bluetooth + IA reducen la HTA no controlada en un 35% (Estudio TASMIN-SR, UK). El monitoreo ambulatorio 24h (MAPA) es el gold standard diagnóstico.`
      },
      {
        keys: ["diabetes", "glucosa", "insulina"],
        txt: `💉 *Insulina biosintética (1982):* Antes de la insulina de ADN recombinante (Humulin, Eli Lilly), los diabéticos usaban insulina porcina/bovina con más efectos adversos. Hoy hay >30 tipos de insulina disponibles.\n\n⌚ *Sistemas de monitoreo continuo (CGM):* El sensor FreeStyle Libre mide glucosa intersticial cada minuto sin punción. Los sistemas de asa cerrada (páncreas artificial) ajustan la insulina automáticamente — reducen HbA1c en 0.5% y tiempo en hipoglucemia en 40%.\n\n🦠 *Microbioma intestinal y DM2:* El microbioma de pacientes con DM2 muestra menos Akkermansia muciniphila y Faecalibacterium prausnitzii. El trasplante de microbiota fecal de donantes sanos mejora la sensibilidad a insulina en estudios piloto.\n\n🧬 *Farmacogenómica:* La variante TCF7L2 rs7903146 aumenta 40% el riesgo de DM2. Los polimorfismos en SLC22A1 determinan la eficacia de metformina. La medicina de precisión personaliza tratamientos según el genoma del paciente.`
      },
      {
        keys: ["sistema inmune", "inmun", "vacuna"],
        txt: `💉 *Vacunas ARNm (COVID-19):* Pfizer-BioNTech y Moderna usaron nanopartículas lipídicas para entregar ARNm del spike de SARS-CoV-2. Eficacia >94% contra enfermedad severa. Tecnología ahora aplicada a vacunas contra VIH, cáncer y otras enfermedades.\n\n🦠 *Inmunoterapia oncológica:* Los inhibidores de checkpoint (anti-PD1/PD-L1) como pembrolizumab "desbloquean" los linfocitos T para atacar células tumorales. Sobrevida a 5 años en melanoma avanzado: de <10% a >40%.\n\n🤧 *Inmunoterapia para alergias:* La inmunoterapia sublingual o subcutánea reprograma la respuesta Th2→Th1, reduciendo síntomas alérgicos en un 85% de los pacientes tras 3 años de tratamiento.\n\n🍼 *Lactancia materna e inmunidad:* La leche materna contiene IgA secretora, lactoferrina, lisozima y oligosacáridos humanos (HMO) que reducen infecciones respiratorias en 72% y diarreas en 64% en lactantes (OPS/OMS 2022).`
      }
    ]
  };

  const materiaEX = EX[mat] || [];
  for (const entry of materiaEX) {
    if (entry.keys.some(k => t.includes(k))) return entry.txt;
  }
  return `🌍 *Aplicación 1:* "${tema}" es fundamental en investigación científica y desarrollo tecnológico actual.\n🏫 *Aplicación 2:* Los profesionales de ${NOMBRES_MAP[mat]||mat} aplican este concepto en diagnóstico, diseño y resolución de problemas reales.\n💡 *Aplicación 3:* Pide un tema más específico para obtener ejemplos precisos con datos y estudios reales.`;
}

// ══════════════════════════════════════════════════════
// CIFRAS Y DATOS PARA GRÁFICAS
// ══════════════════════════════════════════════════════
function getCifrasDB(mat, tema) {
  const t = tema.toLowerCase();
  const DATA = {
    fisica: {
      newton: `📊 Aceleración de la gravedad en planetas:\n  Tierra: 9.8 m/s² | Marte: 3.7 | Luna: 1.6 | Júpiter: 24.8\n📊 Récords de aceleración:\n  Caza F-16: hasta 90 m/s² (9g)\n  Cohete Saturno V al despegue: ~15 m/s²`,
      energia: `📊 Conversiones energéticas:\n  1 kWh = 3.6 MJ | 1 kcal = 4186 J\n📊 Potencia típica:\n  Bombillo LED: 9W | Persona caminando: 70W\n  Auto a 100 km/h: ~20,000W | Cohete: ~11,000 MW`
    }
  };
  const mDB = DATA[mat] || {};
  for (const k of Object.keys(mDB)) {
    if (t.includes(k)) return mDB[k];
  }
  return `📊 Consulta la pestaña "Gráficas" para ver representaciones visuales de datos sobre ${tema}.`;
}

const NOMBRES_MAP = {
  fisica:"Física", quimica:"Química", matematicas:"Matemáticas",
  biologia:"Biología", salud:"Ciencias de la Salud"
};
