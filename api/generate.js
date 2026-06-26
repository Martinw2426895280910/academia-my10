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
    // ══════════════════════════════════════════
    // 1. BUSCAR PÁGINA EN WIKIPEDIA ESPAÑOL
    // ══════════════════════════════════════════
    const buscarPagina = async (query) => {
      // Primero intento directo
      const directUrl = `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
      const r = await fetch(directUrl, { headers: { "User-Agent": "AcademiaMY10/2.0" } });
      if (r.ok) {
        const d = await r.json();
        if (d.type !== "disambiguation" && d.extract && d.extract.length > 100) return d;
      }
      // Fallback: búsqueda libre
      const searchUrl = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query + " " + (NOMBRES[materia]||""))}&format=json&utf8=1&srlimit=5&origin=*`;
      const sr = await fetch(searchUrl);
      const sd = await sr.json();
      const results = sd?.query?.search || [];
      for (const result of results) {
        const pr = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(result.title)}`, { headers: { "User-Agent": "AcademiaMY10/2.0" } });
        if (pr.ok) {
          const pd = await pr.json();
          if (pd.extract && pd.extract.length > 100) return pd;
        }
      }
      return null;
    };

    // ══════════════════════════════════════════
    // 2. OBTENER CONTENIDO COMPLETO DE WIKIPEDIA
    // ══════════════════════════════════════════
    const obtenerContenidoCompleto = async (titulo) => {
      const url = `https://es.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titulo)}&prop=extracts|sections&exintro=false&explaintext=true&exsectionformat=plain&format=json&utf8=1&origin=*&exlimit=1`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const d = await r.json();
      const pages = d?.query?.pages || {};
      const page = Object.values(pages)[0];
      return page?.extract || null;
    };

    // ══════════════════════════════════════════
    // 3. OBTENER SECCIONES ESTRUCTURADAS
    // ══════════════════════════════════════════
    const obtenerSecciones = async (titulo) => {
      const url = `https://es.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(titulo)}&prop=sections&format=json&origin=*`;
      const r = await fetch(url);
      if (!r.ok) return [];
      const d = await r.json();
      return (d?.parse?.sections || []).slice(0, 12).map(s => s.line.replace(/<[^>]+>/g,''));
    };

    // ══════════════════════════════════════════
    // 4. BUSCAR ARTÍCULO RELACIONADO EN INGLÉS
    //    (como fallback y datos adicionales)
    // ══════════════════════════════════════════
    const buscarWikiEn = async (query) => {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`, { headers: { "User-Agent": "AcademiaMY10/2.0" } });
      if (r.ok) { const d = await r.json(); if (d.extract) return d; }
      return null;
    };

    // ══ EJECUTAR BÚSQUEDAS EN PARALELO ══
    const [wikiEs, wikiEn] = await Promise.all([
      buscarPagina(tema),
      buscarWikiEn(tema)
    ]);

    const tituloPagina = wikiEs?.title || tema;
    const urlWiki = wikiEs?.content_urls?.desktop?.page || `https://es.wikipedia.org/wiki/${encodeURIComponent(tema)}`;

    // Obtener contenido completo + secciones en paralelo
    const [textoCompleto, secciones] = await Promise.all([
      wikiEs ? obtenerContenidoCompleto(tituloPagina) : Promise.resolve(null),
      wikiEs ? obtenerSecciones(tituloPagina) : Promise.resolve([])
    ]);

    // ══════════════════════════════════════════
    // 5. PROCESAR Y LIMPIAR EL TEXTO
    // ══════════════════════════════════════════
    const limpiarTexto = (txt) => {
      if (!txt) return "";
      return txt
        .replace(/\s+/g, ' ')
        .replace(/\[[\d\w]+\]/g, '')   // quitar citas [1], [2]
        .replace(/={2,}[^=]+=={2,}/g, '') // quitar encabezados wiki
        .trim();
    };

    // Dividir texto completo en párrafos útiles
    const extractoResumen = limpiarTexto(wikiEs?.extract || wikiEn?.extract || "");
    const textoTotal = limpiarTexto(textoCompleto || extractoResumen);

    // Obtener oraciones significativas
    const oracionesTotales = textoTotal
      .split(/(?<=[.!?])\s+/)
      .map(o => o.trim())
      .filter(o => o.length > 50 && o.length < 500);

    // Párrafos del texto completo (separados por doble salto)
    const parrafos = textoTotal
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(p => p.length > 80)
      .slice(0, 15);

    // ══════════════════════════════════════════
    // 6. CONSTRUIR RESPUESTA SEGÚN TIPO
    // ══════════════════════════════════════════
    const matEmoji = EMOJIS[materia] || "📚";
    const matNombre = NOMBRES[materia] || materia;
    let texto = "";

    // ENCABEZADO SIEMPRE
    texto += `${matEmoji} *${tituloPagina.toUpperCase()}*\n`;
    texto += `📚 ${matNombre} | Academia MY 10\n`;
    texto += `══════════════════════\n\n`;

    // ─── RESUMEN ───
    if (tipo === "resumen" || tipo === "todo") {
      texto += `📌 *¿QUÉ ES?*\n`;
      // Primer párrafo completo (definición)
      const defParrafo = parrafos[0] || oracionesTotales.slice(0,3).join(" ");
      texto += `${defParrafo.slice(0, 500)}\n\n`;

      texto += `📋 *PUNTOS CLAVE:*\n`;
      // Tomar oraciones representativas de distintas partes del texto
      const paso = Math.max(1, Math.floor(oracionesTotales.length / 6));
      const puntosIdx = [0, paso, paso*2, paso*3, paso*4, paso*5];
      puntosIdx.forEach(idx => {
        const o = oracionesTotales[idx];
        if (o) texto += `✅ ${o.slice(0, 220)}\n`;
      });

      // Párrafo adicional de contexto
      if (parrafos[1]) {
        texto += `\n📖 *MÁS DETALLE:*\n${parrafos[1].slice(0, 400)}\n`;
      }
      if (parrafos[2]) {
        texto += `\n${parrafos[2].slice(0, 300)}\n`;
      }
    }

    // ─── FÓRMULAS / CONCEPTOS ───
    if (tipo === "formulas" || tipo === "todo") {
      texto += `\n══════════════════════\n`;
      texto += `🔣 *CONCEPTOS Y FÓRMULAS*\n\n`;
      const formulasDB = getFormulas(materia, tema);
      if (formulasDB) {
        texto += formulasDB + "\n";
      }
      // Agregar info de Wikipedia relacionada con fórmulas/definiciones
      const oracionesConcepto = oracionesTotales
        .filter(o => /(\bse define\b|\bse conoce\b|\bconsiste\b|\bprincipio\b|\bley\b|\bteor[ií]a\b|\bfórmula\b|\becuaci[oó]n\b|\bconcepto\b)/i.test(o))
        .slice(0, 4);
      if (oracionesConcepto.length > 0) {
        texto += `\n📚 *Según Wikipedia:*\n`;
        oracionesConcepto.forEach(o => { texto += `📌 ${o.slice(0,250)}\n`; });
      }
      // Secciones temáticas
      if (secciones.length > 0) {
        texto += `\n🗂️ *Subtemas en Wikipedia:*\n`;
        secciones.slice(0, 8).forEach(s => { texto += `• ${s}\n`; });
      }
    }

    // ─── EJERCICIOS ───
    if (tipo === "ejercicios" || tipo === "todo") {
      texto += `\n══════════════════════\n`;
      texto += `✏️ *EJERCICIO RESUELTO*\n\n`;
      texto += getEjercicio(materia, tema, oracionesTotales);
    }

    // ─── EJEMPLOS ───
    if (tipo === "ejemplos" || tipo === "todo") {
      texto += `\n══════════════════════\n`;
      texto += `💡 *APLICACIONES REALES*\n\n`;
      texto += getEjemplos(materia, tema);

      // Dato curioso de Wikipedia
      const datoCurioso = oracionesTotales
        .filter(o => /(\bpor primera vez\b|\bhistoria\b|\bdescubri\b|\bdemostr\b|\binvent\b|\bcurioso\b|\brecord\b|\bmayor\b|\bm[áa]s\b)/i.test(o))
        .find(o => o.length > 60);
      if (datoCurioso) {
        texto += `\n⭐ *DATO CURIOSO (Wikipedia):*\n${datoCurioso.slice(0,280)}\n`;
      }
    }

    // ─── SOLO RESUMEN (tipo="resumen") — agregar más párrafos ───
    if (tipo === "resumen") {
      parrafos.slice(3, 6).forEach(p => {
        if (p.length > 100) texto += `\n${p.slice(0, 350)}\n`;
      });
    }

    // PIE
    texto += `\n══════════════════════\n`;
    texto += `🌐 Fuente: Wikipedia — ${tituloPagina}\n`;
    texto += `📲 *Academia MY 10* — ¡Todo por WhatsApp! 🏆`;

    return res.status(200).json({ texto, fuente: urlWiki, titulo: tituloPagina });

  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Error interno: " + err.message });
  }
}

// ══════════════════════════════════════════
// FÓRMULAS POR MATERIA
// ══════════════════════════════════════════
function getFormulas(materia, tema) {
  const t = tema.toLowerCase();
  const DB = {
    fisica: [
      { keys:["newton","fuerza","din[aá]mica"], val:`📌 *1ª Ley (Inercia):* Objeto en reposo permanece en reposo sin fuerza neta.\n📌 *2ª Ley:* F = m × a  (Newton = kg·m/s²)\n📌 *3ª Ley:* Acción = −Reacción\n⚠️ Masa (kg) ≠ Peso (N). Peso = m × g  (g = 9.8 m/s²)` },
      { keys:["cinemat","velocidad","aceleraci"], val:`📌 v = v₀ + at\n📌 x = v₀t + ½at²\n📌 v² = v₀² + 2ax\n📌 v_media = Δx / Δt\n⚠️ En caída libre: a = g = 9.8 m/s² (hacia abajo)` },
      { keys:["energ","trabajo","potencia"], val:`📌 Ec = ½mv²  (cinética)\n📌 Ep = mgh  (potencial gravitatoria)\n📌 W = F·d·cosθ  (trabajo)\n📌 P = W/t  (potencia, en Watts)\n📌 Conservación: Ec₁ + Ep₁ = Ec₂ + Ep₂` },
      { keys:["termodin","calor","temperatura","gas"], val:`📌 ΔU = Q − W  (1ª Ley Termodinámica)\n📌 PV = nRT  (Gas ideal, R = 8.314 J/mol·K)\n📌 η_Carnot = 1 − Tc/Th\n📌 Q = mcΔT  (calor sensible)\n⚠️ 0°C = 273.15 K` },
      { keys:["electr","corriente","volt","ohm"], val:`📌 V = I·R  (Ley de Ohm)\n📌 P = V·I = I²R = V²/R\n📌 F = kq₁q₂/r²  (Coulomb, k = 9×10⁹)\n📌 Serie: R_total = R₁+R₂+...\n📌 Paralelo: 1/R = 1/R₁+1/R₂+...` },
      { keys:["onda","sonido","luz","frecuencia"], val:`📌 v = λ·f  (velocidad = longitud de onda × frecuencia)\n📌 T = 1/f  (período)\n📌 Sonido en aire: ~343 m/s\n📌 Luz en vacío: c = 3×10⁸ m/s\n📌 n = c/v  (índice de refracción)` },
    ],
    quimica: [
      { keys:["acido","base","ph","neutraliz"], val:`📌 pH = −log[H⁺]\n📌 pH + pOH = 14\n📌 Kw = [H⁺][OH⁻] = 10⁻¹⁴\n📌 Ácido: pH<7 | Neutro: pH=7 | Base: pH>7\n⚠️ Ácidos fuertes: HCl, H₂SO₄, HNO₃\n⚠️ Bases fuertes: NaOH, KOH, Ca(OH)₂` },
      { keys:["mol","estequio","masa molar","rendimiento"], val:`📌 n = m/M  (mol = masa/masa molar)\n📌 N = n × Nₐ  (Nₐ = 6.022×10²³)\n📌 PV = nRT  (gases)\n📌 Rendimiento = (real/teórico)×100%\n⚠️ Balancear ecuación antes de calcular` },
      { keys:["enlace","ion","covalente","electronega"], val:`📌 Iónico: ΔEN > 1.7 (metal+no metal)\n📌 Covalente polar: 0.4 < ΔEN ≤ 1.7\n📌 Covalente no polar: ΔEN < 0.4\n📌 Electronegatividad: F(4.0)>O(3.5)>N(3.0)>Cl(3.2)\n📌 Metálico: electrones deslocalizados` },
      { keys:["oxidacion","redox","electron"], val:`📌 Oxidación: PIERDE electrones (aumenta N° oxidación)\n📌 Reducción: GANA electrones (disminuye N° oxidación)\n📌 OIL RIG: Oxidation Is Loss, Reduction Is Gain\n📌 Celda Galvánica: ánodo(−)→cátodo(+)\n⚠️ La suma de N° oxidación en compuesto neutro = 0` },
    ],
    matematicas: [
      { keys:["derivada","diferencial","deri"], val:`📌 (xⁿ)' = nxⁿ⁻¹\n📌 (sin x)' = cos x  |  (cos x)' = −sin x\n📌 (eˣ)' = eˣ  |  (ln x)' = 1/x\n📌 Regla cadena: [f(g)]' = f'(g)·g'\n📌 Producto: (uv)' = u'v + uv'\n📌 Cociente: (u/v)' = (u'v − uv')/v²` },
      { keys:["integral","antideriva","integra"], val:`📌 ∫xⁿdx = xⁿ⁺¹/(n+1) + C  (n≠−1)\n📌 ∫sin x dx = −cos x + C\n📌 ∫cos x dx = sin x + C\n📌 ∫eˣdx = eˣ + C\n📌 ∫(1/x)dx = ln|x| + C\n⚠️ No olvides +C en integrales indefinidas` },
      { keys:["trigono","seno","coseno","tangen"], val:`📌 sin²θ + cos²θ = 1\n📌 tan θ = sin θ/cos θ\n📌 sin(A±B) = sinA·cosB ± cosA·sinB\n📌 cos(A±B) = cosA·cosB ∓ sinA·sinB\n📌 Ley senos: a/sinA = b/sinB = c/sinC\n📌 Ley cosenos: c² = a²+b²−2ab·cosC` },
      { keys:["probabilidad","estadistic","permut","combin"], val:`📌 P(A) = casos favorables / casos totales\n📌 P(A∪B) = P(A)+P(B)−P(A∩B)\n📌 P(A∩B) = P(A)·P(B)  si son independientes\n📌 Permutaciones: P(n,r) = n!/(n−r)!\n📌 Combinaciones: C(n,r) = n!/[r!(n−r)!]\n📌 Media: x̄ = Σx/n` },
      { keys:["limit","continuid","infinito"], val:`📌 lím(x→a)[f(x)+g(x)] = lím f + lím g\n📌 Regla de L'Hôpital: lím f/g = lím f'/g'  (forma 0/0)\n📌 lím(1+1/n)ⁿ = e  cuando n→∞\n📌 Continuidad: f(a) existe, lím existe y son iguales\n⚠️ Verificar siempre que el denominador ≠ 0` },
    ],
    biologia: [
      { keys:["celula","organelo","membrana"], val:`📌 Procariota: sin núcleo (bacterias, arqueas)\n📌 Eucariota: con núcleo (animales, plantas, hongos)\n📌 Membrana: bicapa fosfolipídica + proteínas\n📌 ATP: adenosín trifosfato (moneda energética)\n📌 Mitocondria: respiración celular\n📌 Cloroplasto: fotosíntesis (solo plantas)` },
      { keys:["fotosint","clorofila","glucosa"], val:`📌 6CO₂ + 6H₂O + luz → C₆H₁₂O₆ + 6O₂\n📌 Fase luminosa: en tilacoides (produce ATP, NADPH)\n📌 Ciclo de Calvin: en estroma (fija CO₂)\n📌 Clorofila a y b: absorben rojo y azul\n⚠️ La fotosíntesis consume CO₂ y produce O₂` },
      { keys:["genetica","adn","arn","proteina","gen"], val:`📌 ADN → ARNm → Proteína (Dogma central)\n📌 Bases: Adenina(A)-Timina(T) | Guanina(G)-Citosina(C)\n📌 En ARN: Uracilo(U) reemplaza a Timina(T)\n📌 Codón: triplete de bases que codifica 1 aminoácido\n📌 Gen dominante (A) oculta al recesivo (a)\n📌 Genotipo: genes | Fenotipo: características visibles` },
      { keys:["evolucion","darwin","seleccion","especie"], val:`📌 Selección natural: sobreviven los más adaptados\n📌 Variación + Herencia + Selección = Evolución\n📌 Deriva genética: cambio por azar (poblaciones pequeñas)\n📌 Especiación: formación de nuevas especies\n📌 Evidencias: fósiles, anatomía comparada, ADN` },
    ],
    salud: [
      { keys:["hipertension","presion","cardiovasc"], val:`📌 Normal: <120/80 mmHg\n📌 Elevada: 120-129/<80 mmHg\n📌 HTA Grado 1: 130-139/80-89 mmHg\n📌 HTA Grado 2: ≥140/≥90 mmHg\n📌 Crisis: >180/120 mmHg (emergencia)\n⚠️ Factores: sal, estrés, sedentarismo, obesidad, genética` },
      { keys:["diabetes","glucosa","insulina"], val:`📌 Glucosa normal ayunas: 70-100 mg/dL\n📌 Prediabetes: 100-125 mg/dL\n📌 Diabetes: ≥126 mg/dL (confirmado 2 veces)\n📌 HbA1c objetivo en diabéticos: <7%\n📌 Tipo 1: destrucción autoinmune de células β\n📌 Tipo 2: resistencia a insulina + déficit relativo` },
      { keys:["inmun","vacuna","anticuerpo","sistema inmune"], val:`📌 Inmunidad innata: respuesta rápida, inespecífica\n📌 Inmunidad adaptativa: linfocitos B y T, específica\n📌 Anticuerpo (Ig): proteína que neutraliza antígenos\n📌 Vacuna: estimula memoria inmunológica sin enfermedad\n📌 IgG: más abundante, cruza placenta\n📌 IgA: protege mucosas (saliva, leche materna)` },
      { keys:["nutricion","vitamina","mineral","dieta"], val:`📌 Macronutrientes: carbohidratos (4 kcal/g), proteínas (4 kcal/g), grasas (9 kcal/g)\n📌 IMC = Peso(kg) / Talla(m)²\n📌 IMC: <18.5 bajo peso | 18.5-24.9 normal | ≥25 sobrepeso | ≥30 obesidad\n📌 Agua: 2-3 litros/día (adulto)\n⚠️ Vitamina D: síntesis solar + alimentos` },
      { keys:["primeros auxilios","emergencia","rcp","hemorragia"], val:`📌 RCP: 30 compresiones / 2 ventilaciones\n📌 Compresiones: centro del pecho, 5-6 cm profundidad, 100-120/min\n📌 OVACE: 5 golpes en espalda + 5 compresiones abdominales (Heimlich)\n📌 Hemorragia: presión directa + elevar extremidad\n📌 RICE: Reposo, Hielo, Compresión, Elevación (esguinces)\n⚠️ Llamar servicios de emergencia SIEMPRE primero` },
    ]
  };

  const materiaDB = DB[materia] || [];
  for (const entry of materiaDB) {
    if (entry.keys.some(k => new RegExp(k, 'i').test(tema))) return entry.val;
  }
  return null;
}

// ══════════════════════════════════════════
// EJERCICIOS RESUELTOS
// ══════════════════════════════════════════
function getEjercicio(materia, tema, oraciones) {
  const t = tema.toLowerCase();
  const EJ = {
    fisica: [
      { keys:["newton","fuerza"], txt:`*Problema:* Un auto de 1200 kg acelera de 0 a 90 km/h en 10 s. ¿Qué fuerza neta actúa?\n\n*Solución paso a paso:*\n1️⃣ Convertir: 90 km/h = 25 m/s\n2️⃣ Calcular aceleración: a = Δv/t = 25/10 = 2.5 m/s²\n3️⃣ Aplicar 2ª Ley: F = m×a = 1200×2.5\n✅ *Resultado: F = 3000 N*` },
      { keys:["cinemat","velocidad"], txt:`*Problema:* Un objeto parte del reposo y cae libremente durante 3 segundos. ¿Qué velocidad alcanza y qué distancia recorre?\n\n*Solución:*\n1️⃣ Datos: v₀=0, a=g=9.8 m/s², t=3 s\n2️⃣ Velocidad: v = v₀ + at = 0 + 9.8×3 = *29.4 m/s*\n3️⃣ Distancia: x = ½at² = ½×9.8×9 = *44.1 m*\n✅ Cae a 29.4 m/s habiendo recorrido 44.1 m.` },
      { keys:["energ","trabajo"], txt:`*Problema:* Una pesa de 5 kg se suelta desde 10 m de altura. ¿Cuál es su velocidad justo antes de tocar el suelo?\n\n*Solución:*\n1️⃣ Ep inicial = mgh = 5×9.8×10 = 490 J\n2️⃣ Conservación de energía: Ec = Ep → ½mv² = 490\n3️⃣ v² = 2×490/5 = 196\n✅ *v = 14 m/s*` },
    ],
    quimica: [
      { keys:["acido","ph"], txt:`*Problema:* Calcula el pH de una solución de HCl 0.005 M.\n\n*Solución:*\n1️⃣ HCl es ácido fuerte → ionización completa\n2️⃣ [H⁺] = 0.005 M = 5×10⁻³ M\n3️⃣ pH = −log(5×10⁻³) = −(log5 + log10⁻³)\n4️⃣ pH = −(0.699 − 3) = 3 − 0.699\n✅ *pH ≈ 2.3*` },
      { keys:["mol","estequio"], txt:`*Problema:* ¿Cuántos gramos de CO₂ se producen al quemar 12g de carbono?\n\nC + O₂ → CO₂\n\n*Solución:*\n1️⃣ Masa molar C = 12 g/mol → n(C) = 12/12 = 1 mol\n2️⃣ Relación 1:1 en la ecuación → n(CO₂) = 1 mol\n3️⃣ Masa molar CO₂ = 12+32 = 44 g/mol\n✅ *Masa CO₂ = 1 × 44 = 44 g*` },
    ],
    matematicas: [
      { keys:["derivada"], txt:`*Problema:* Encuentra f'(x) y los puntos críticos de f(x) = x³ − 6x² + 9x − 2\n\n*Solución:*\n1️⃣ f'(x) = 3x² − 12x + 9\n2️⃣ Igualar a 0: 3x² − 12x + 9 = 0 → x² − 4x + 3 = 0\n3️⃣ Factorizar: (x−1)(x−3) = 0\n✅ *Puntos críticos: x=1 (máximo local) y x=3 (mínimo local)*` },
      { keys:["integral"], txt:`*Problema:* Calcula el área bajo la curva f(x) = x² entre x=0 y x=3.\n\n*Solución:*\n1️⃣ Área = ∫₀³ x² dx\n2️⃣ Antiderivada: x³/3\n3️⃣ Evaluar: [x³/3]₀³ = (27/3) − (0/3)\n✅ *Área = 9 unidades cuadradas*` },
      { keys:["trigono","seno","coseno"], txt:`*Problema:* En un triángulo, a=7, b=5, C=60°. Encuentra el lado c.\n\n*Ley de cosenos:*\n1️⃣ c² = a² + b² − 2ab·cosC\n2️⃣ c² = 49 + 25 − 2(7)(5)cos(60°)\n3️⃣ c² = 74 − 70×0.5 = 74 − 35 = 39\n✅ *c = √39 ≈ 6.24*` },
    ],
    biologia: [
      { keys:["genetica","gen","herencia"], txt:`*Problema:* Un hombre daltónico (X^d Y) se casa con una mujer portadora (X^D X^d). ¿Qué proporción de hijos será daltónica?\n\n*Cuadro de Punnett:*\n     X^D    X^d\nX^d  X^D X^d  X^d X^d\nY    X^D Y    X^d Y\n\n1️⃣ Hijas: 50% normales, 50% portadoras\n2️⃣ Hijos: 50% normales, 50% daltónicos\n✅ *25% del total de hijos será daltónico*` },
      { keys:["celula","division","mitosis"], txt:`*Problema:* Una célula con 2n=8 cromosomas entra en mitosis. ¿Cuántos cromosomas tendrán las células hijas?\n\n*Solución:*\n1️⃣ Mitosis conserva el número cromosómico\n2️⃣ No hay reducción (eso es meiosis)\n3️⃣ Las 2 células hijas tendrán el mismo número\n✅ *Cada célula hija tendrá 2n = 8 cromosomas*` },
    ],
    salud: [
      { keys:["hipertension","presion"], txt:`*Caso clínico:* Paciente de 55 años con PA 145/92 mmHg en 3 consultas distintas. ¿Cómo se clasifica?\n\n*Análisis:*\n1️⃣ Sistólica 145 ≥ 140 → criterio HTA grado 2\n2️⃣ Diastólica 92 ≥ 90 → criterio HTA grado 2\n3️⃣ Confirmado en 3 mediciones = diagnóstico\n✅ *HTA Grado 2. Requiere medicación + cambios de estilo de vida*` },
      { keys:["diabetes","glucosa"], txt:`*Caso clínico:* Glucosa en ayunas: 132 mg/dL. HbA1c: 7.2%. ¿Es diabético?\n\n*Criterios diagnósticos ADA:*\n1️⃣ Glucosa ayunas ≥126 mg/dL ✅ (132>126)\n2️⃣ HbA1c ≥6.5% ✅ (7.2>6.5)\n3️⃣ Dos criterios positivos = diagnóstico confirmado\n✅ *Diabetes mellitus tipo 2 confirmada*` },
    ]
  };

  const materiaEJ = EJ[materia] || [];
  for (const entry of materiaEJ) {
    if (entry.keys.some(k => t.includes(k))) return entry.txt;
  }

  // Ejercicio genérico con info de Wikipedia
  const ej1 = oraciones.find(o => o.length > 60 && o.length < 200) || "";
  const ej2 = oraciones.find((o,i) => i > 2 && o.length > 60 && o.length < 200) || "";
  return `*Ejercicio de comprensión sobre "${tema}":*\n\n❓ Basándote en lo estudiado, ¿cuál es el principio fundamental de este tema?\n\n📝 *Respuesta:*\n✅ ${ej1.slice(0,220)}\n\n💭 *Reflexión adicional:*\n${ej2.slice(0,220)}\n\n⚠️ Para ejercicios numéricos específicos, consulta a tu docente o libro de texto.`;
}

// ══════════════════════════════════════════
// EJEMPLOS DE LA VIDA REAL
// ══════════════════════════════════════════
function getEjemplos(materia, tema) {
  const t = tema.toLowerCase();
  const EX = {
    fisica: [
      { keys:["newton","fuerza"], txt:`🚗 *Autos:* Los airbags aumentan el tiempo de colisión, reduciendo la fuerza sobre el ocupante (2ª Ley).\n🛸 *Cohetes:* Expulsan gas hacia abajo → el cohete sube (3ª Ley de Newton).\n🏒 *Deporte:* Un disco de hockey sobre hielo se desliza largo tiempo sin fuerza (1ª Ley - inercia).\n⚽ *Fútbol:* El portero que atrapa el balón siente la fuerza del mismo (3ª Ley).` },
      { keys:["energ","trabajo"], txt:`💡 *Hidroeléctrica:* Ep del agua → Ec → electricidad (conversión de energía).\n🎢 *Montaña rusa:* Ep en la cima → Ec al bajar → de vuelta a Ep.\n🔋 *Baterías:* Energía química → eléctrica.\n🌞 *Paneles solares:* Energía lumínica → eléctrica (efecto fotovoltaico).` },
      { keys:["termodin","calor"], txt:`🍳 *Cocinar:* El calor fluye del fuego (Th) a la sartén (Tc) — 2ª ley termodinámica.\n❄️ *Refrigerador:* Bombea calor del interior frío al exterior caliente (requiere trabajo).\n🚗 *Motor de auto:* Solo el 25-40% de la energía del combustible se convierte en movimiento.\n☕ *Café caliente:* Pierde calor hasta equilibrarse con la temperatura ambiente.` },
    ],
    quimica: [
      { keys:["acido","ph"], txt:`🍋 *Limón:* pH ~2.0 — ácido cítrico le da su sabor agrio.\n🧼 *Jabón:* pH 9-10 — básico, rompe la grasa por saponificación.\n🩸 *Sangre:* pH 7.35-7.45 — regulado por tampones bicarbonato.\n🦷 *Caries:* Las bacterias producen ácidos (pH<5.5) que disuelven el esmalte dental.` },
      { keys:["reacci","combusti"], txt:`🍞 *Pan:* La levadura fermenta (CO₂ hace esponjar la masa) — reacción bioquímica.\n🚗 *Gasolina:* C₈H₁₈ + O₂ → CO₂ + H₂O + energía (combustión).\n🎆 *Fuegos artificiales:* Sales metálicas emiten luz de colores al oxidarse.\n🔋 *Pilas:* Reacción redox espontánea genera corriente eléctrica.` },
    ],
    matematicas: [
      { keys:["derivada"], txt:`📈 *Economía:* El costo marginal es la derivada del costo total respecto a la producción.\n🚗 *Física:* La velocidad es la derivada de la posición; la aceleración, la derivada de la velocidad.\n💹 *Bolsa:* La tasa de cambio del precio de una acción es su derivada temporal.\n🌡️ *Enfriamiento:* La ley de Newton de enfriamiento usa derivadas de temperatura.` },
      { keys:["integral"], txt:`🏗️ *Ingeniería:* Las integrales calculan áreas, volúmenes y centros de masa de estructuras.\n⚡ *Electricidad:* La carga eléctrica es la integral de la corriente respecto al tiempo.\n💊 *Medicina:* La farmacocinética usa integrales para calcular la dosis total absorbida.\n📐 *Arquitectura:* Cálculo de volúmenes de bóvedas y cúpulas.` },
      { keys:["probabilidad"], txt:`🎲 *Seguros:* Las compañías calculan primas según probabilidades de accidentes o enfermedades.\n🏥 *Medicina:* Sensibilidad y especificidad de pruebas diagnósticas.\n📊 *Sondeos:* Las encuestas electorales usan muestreo probabilístico.\n🎰 *Juegos de azar:* La probabilidad explica por qué la casa siempre gana a largo plazo.` },
    ],
    biologia: [
      { keys:["celula"], txt:`🧬 *Medicina:* Las células cancerosas se dividen sin control — entenderlas permite tratarlas.\n🌱 *Agricultura:* El cultivo de tejidos vegetales propaga plantas sin semillas.\n🩸 *Transfusión:* Los grupos sanguíneos dependen de proteínas en la membrana celular.\n💉 *Vacunas:* Entrenan células del sistema inmune para reconocer patógenos.` },
      { keys:["fotosint"], txt:`🌾 *Agricultura:* Los cultivos capturan luz solar → alimento para miles de millones.\n🌊 *Océanos:* El fitoplancton produce ~50% del O₂ atmosférico terrestre.\n⛽ *Combustibles fósiles:* Son fotosíntesis acumulada durante millones de años.\n🏙️ *Techos verdes:* Las plantas urbanas reducen CO₂ y la temperatura de la ciudad.` },
      { keys:["genetica"], txt:`🌽 *OGM:* El maíz Bt tiene gen de bacteria que lo hace resistente a plagas.\n💉 *Insulina:* Producida por bacterias con el gen humano de insulina insertado.\n🔬 *Medicina forense:* La huella de ADN identifica personas con 99.9% de certeza.\n🐑 *Dolly:* Primera oveja clonada (1996) — la genética permite la clonación.` },
    ],
    salud: [
      { keys:["hipertension"], txt:`🧂 *Sal:* Reducir a <5g/día puede bajar la PA hasta 5-6 mmHg.\n🚶 *Ejercicio:* 30 min de caminata diaria reduce riesgo cardiovascular en 35%.\n😴 *Sueño:* Dormir <6h/noche aumenta 20% el riesgo de hipertensión.\n🧘 *Estrés:* El cortisol crónico constriñe vasos sanguíneos → sube la PA.` },
      { keys:["diabetes"], txt:`🥗 *Dieta mediterránea:* Reduce incidencia de DM2 en 52% (estudio PREDIMED).\n🏃 *Ejercicio:* 150 min/semana de actividad moderada mejora la sensibilidad a insulina.\n⌚ *Monitoreo:* Los glucómetros continuos permiten ajustar dosis en tiempo real.\n💊 *Metformina:* Primer fármaco de elección en DM2; reduce glucosa y riesgo cardiovascular.` },
      { keys:["inmun","sistema inmune"], txt:`💉 *Vacunas:* Crean memoria inmunológica sin causar la enfermedad.\n🤧 *Alergias:* El sistema inmune reacciona exageradamente a sustancias inofensivas.\n🏥 *Trasplantes:* Se necesitan inmunosupresores para evitar el rechazo del órgano.\n😴 *Sueño:* Dormir <7h reduce en 3x las probabilidades de resfriarse (estudio UCSF).` },
    ]
  };

  const materiaEX = EX[materia] || [];
  for (const entry of materiaEX) {
    if (entry.keys.some(k => t.includes(k))) return entry.txt;
  }
  return `🌍 *Aplicación 1:* El tema "${tema}" se aplica en investigación científica y tecnología actual.\n🏫 *Aplicación 2:* Estudiantes y profesionales de ${NOMBRES_LOCAL[materia]||materia} usan estos conceptos diariamente.\n💼 *Aplicación 3:* Industria, medicina e ingeniería basan muchos procesos en estos principios.\n📱 *Aplicación 4:* La tecnología moderna (smartphones, internet, medicina) depende de estos fundamentos.`;
}

const NOMBRES_LOCAL = {
  fisica:"Física",quimica:"Química",matematicas:"Matemáticas",biologia:"Biología",salud:"Ciencias de la Salud"
};
