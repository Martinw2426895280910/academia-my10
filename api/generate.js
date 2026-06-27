export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { materia, tema, tipo } = req.body || {};
  if (!materia || !tema || !tipo) {
    return res.status(400).json({ error: "Faltan parametros: materia, tema, tipo" });
  }

  const NOMBRES = {
    fisica: "Fisica",
    quimica: "Quimica",
    matematicas: "Matematicas",
    biologia: "Biologia",
    salud: "Ciencias de la Salud"
  };

  const EMOJIS = {
    fisica: "Atomico",
    quimica: "Cientifico",
    matematicas: "Regla",
    biologia: "Planta",
    salud: "Medico"
  };

  try {
    // ── 1. Buscar en Wikipedia Espanol ──
    let wikiData = null;

    // Intento directo por titulo
    try {
      const r1 = await fetch(
        "https://es.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(tema),
        { headers: { "User-Agent": "AcademiaMY10/3.0" } }
      );
      if (r1.ok) {
        const d1 = await r1.json();
        if (d1.type !== "disambiguation" && d1.extract && d1.extract.length > 100) {
          wikiData = d1;
        }
      }
    } catch (e) {}

    // Busqueda libre si fallo
    if (!wikiData) {
      try {
        const r2 = await fetch(
          "https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
          encodeURIComponent(tema + " " + (NOMBRES[materia] || "")) +
          "&format=json&utf8=1&srlimit=3&origin=*"
        );
        const d2 = await r2.json();
        const hits = (d2 && d2.query && d2.query.search) ? d2.query.search : [];
        for (const hit of hits) {
          try {
            const r3 = await fetch(
              "https://es.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(hit.title),
              { headers: { "User-Agent": "AcademiaMY10/3.0" } }
            );
            if (r3.ok) {
              const d3 = await r3.json();
              if (d3.extract && d3.extract.length > 100) {
                wikiData = d3;
                break;
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    // ── 2. Texto completo de Wikipedia ──
    let textoCompleto = "";
    let secciones = [];
    const titulo = (wikiData && wikiData.title) ? wikiData.title : tema;
    const urlWiki = (wikiData && wikiData.content_urls && wikiData.content_urls.desktop)
      ? wikiData.content_urls.desktop.page
      : ("https://es.wikipedia.org/wiki/" + encodeURIComponent(tema));

    if (wikiData) {
      try {
        const rFull = await fetch(
          "https://es.wikipedia.org/w/api.php?action=query&titles=" +
          encodeURIComponent(titulo) +
          "&prop=extracts&exintro=false&explaintext=true&exsectionformat=plain&format=json&utf8=1&origin=*&exlimit=1"
        );
        const dFull = await rFull.json();
        const pages = (dFull && dFull.query && dFull.query.pages) ? dFull.query.pages : {};
        const page = Object.values(pages)[0];
        if (page && page.extract) textoCompleto = page.extract;
      } catch (e) {}

      try {
        const rSec = await fetch(
          "https://es.wikipedia.org/w/api.php?action=parse&page=" +
          encodeURIComponent(titulo) +
          "&prop=sections&format=json&origin=*"
        );
        const dSec = await rSec.json();
        secciones = ((dSec && dSec.parse && dSec.parse.sections) ? dSec.parse.sections : [])
          .map(function(s) { return s.line.replace(/<[^>]+>/g, "").trim(); })
          .filter(function(s) { return s.length > 2; })
          .slice(0, 12);
      } catch (e) {}
    }

    // ── 3. Procesar texto ──
    const limpiar = function(txt) {
      if (!txt) return "";
      return txt
        .replace(/\[[\d\w\s,]+\]/g, "")
        .replace(/={2,}[^=]+=={2,}/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    };

    const extracto = (wikiData && wikiData.extract) ? wikiData.extract : "";
    const textoBase = limpiar(textoCompleto || extracto);

    const parrafos = textoBase
      .split(/\n{2,}/)
      .map(function(p) { return p.replace(/\n/g, " ").trim(); })
      .filter(function(p) { return p.length > 80; })
      .slice(0, 12);

    const oraciones = textoBase
      .split(/(?<=[.!?])\s+/)
      .map(function(o) { return o.trim(); })
      .filter(function(o) { return o.length > 55 && o.length < 500; });

    // ── 4. Construir respuesta ──
    const SEP = "══════════════════════";
    const nom = NOMBRES[materia] || materia;
    let texto = "";

    texto += "[" + nom.toUpperCase() + "] " + titulo.toUpperCase() + "\n";
    texto += "Academia MY 10\n";
    texto += SEP + "\n\n";

    // RESUMEN
    if (tipo === "resumen" || tipo === "todo") {
      texto += "DEFINICION:\n";
      if (oraciones.length > 0) {
        texto += oraciones.slice(0, 3).join(" ").slice(0, 600) + "\n\n";
      }

      texto += "PUNTOS CLAVE:\n";
      const paso = Math.max(1, Math.floor(oraciones.length / 6));
      [0, paso, paso * 2, paso * 3, paso * 4, paso * 5].forEach(function(idx) {
        if (oraciones[idx]) {
          texto += "* " + oraciones[idx].slice(0, 220) + "\n";
        }
      });
      texto += "\n";

      if (parrafos.length >= 2) {
        texto += "DESARROLLO:\n";
        parrafos.slice(1, 3).forEach(function(p) {
          texto += p.slice(0, 400) + "\n\n";
        });
      }

      const hist = oraciones.filter(function(o) {
        return /\b(fue|descubrio|demostro|formulo|propuso|publico|siglo|ano|historia)\b/i.test(o);
      }).slice(0, 2);
      if (hist.length > 0) {
        texto += "HISTORIA:\n";
        hist.forEach(function(h) { texto += "* " + h.slice(0, 220) + "\n"; });
        texto += "\n";
      }
    }

    // FORMULAS
    if (tipo === "formulas" || tipo === "todo") {
      texto += SEP + "\n";
      texto += "FORMULAS Y CONCEPTOS CLAVE:\n\n";
      const fDB = getFormulas(materia, tema);
      if (fDB) {
        texto += fDB + "\n";
      } else {
        const conceptos = oraciones.filter(function(o) {
          return /\b(se define|principio|ley|teoria|formula|ecuacion|concepto|propiedad)\b/i.test(o);
        }).slice(0, 4);
        conceptos.forEach(function(c) { texto += "* " + c.slice(0, 260) + "\n"; });
      }
      if (secciones.length > 0) {
        texto += "\nSUBTEMAS EN WIKIPEDIA:\n";
        secciones.slice(0, 8).forEach(function(s) { texto += "  -> " + s + "\n"; });
      }
      texto += "\n";
    }

    // EJERCICIO
    if (tipo === "ejercicios" || tipo === "todo") {
      texto += SEP + "\n";
      texto += "EJERCICIO RESUELTO:\n\n";
      texto += getEjercicio(materia, tema, oraciones);
      texto += "\n";
    }

    // EJEMPLOS
    if (tipo === "ejemplos" || tipo === "todo") {
      texto += SEP + "\n";
      texto += "APLICACIONES REALES:\n\n";
      texto += getEjemplos(materia, tema);
      texto += "\n";
    }

    // PIE
    texto += SEP + "\n";
    texto += "Fuente: Wikipedia - " + titulo + "\n";
    texto += urlWiki + "\n";
    texto += "\nAcademia MY 10 - Todo por WhatsApp!";

    return res.status(200).json({
      texto: texto,
      fuente: urlWiki,
      titulo: titulo,
      parrafos: parrafos.length,
      secciones: secciones.length
    });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Error interno: " + err.message });
  }
}

// ── FORMULAS ──
function getFormulas(mat, tema) {
  var t = tema.toLowerCase();
  var DB = {
    fisica: [
      { keys: ["newton", "fuerza", "dinamica"],
        val: "F = m x a  (2da Ley de Newton)\n  F: Fuerza en Newtons (N)\n  m: masa en kilogramos (kg)\n  a: aceleracion en m/s2\n\nPeso: W = m x g  (g = 9.8 m/s2)\nMomento lineal: p = m x v\nImpulso: J = F x t = Dp\n\n1ra Ley: Si F_neta=0, el cuerpo no cambia su estado de movimiento\n3ra Ley: F_AB = -F_BA (accion y reaccion)" },
      { keys: ["cinemat", "velocidad", "aceleraci", "movimiento"],
        val: "Ecuaciones MUA:\n  v = v0 + at\n  x = v0*t + (1/2)*a*t2\n  v2 = v02 + 2*a*x\n  v_media = Dx / Dt\n\nCaida libre: a = g = 9.8 m/s2\n  h = (1/2)*g*t2\n  v = g*t\n  v2 = 2*g*h" },
      { keys: ["energ", "trabajo", "potencia"],
        val: "Trabajo: W = F x d x cos(O) [Joules]\nEnergia cinetica: Ec = (1/2)*m*v2\nEnergia potencial: Ep = m*g*h\nPotencia: P = W/t = F*v [Watts]\n\nConservacion: Ec1 + Ep1 = Ec2 + Ep2\nTeorema trabajo-energia: W_neto = DEc" },
      { keys: ["termodin", "calor", "temperatura", "gas"],
        val: "1ra Ley: DU = Q - W\n  DU: cambio en energia interna\n  Q: calor absorbido\n  W: trabajo realizado por el sistema\n\nGas ideal: P*V = n*R*T\n  R = 8.314 J/(mol*K)\n  T en Kelvin = C + 273.15\n\nCalor sensible: Q = m*c*DT\nEficiencia Carnot: n = 1 - Tc/Th" },
      { keys: ["electr", "corriente", "volt", "ohm"],
        val: "Ley de Ohm: V = I x R\n  V: tension (Volts)\n  I: corriente (Amperes)\n  R: resistencia (Ohms)\n\nPotencia: P = V*I = I2*R = V2/R\nCoulomb: F = k*q1*q2/r2  (k = 9x10^9)\nSerie: R_T = R1+R2+...\nParalelo: 1/R_T = 1/R1+1/R2+..." },
      { keys: ["onda", "sonido", "luz", "frecuencia", "optica"],
        val: "v = l x f  (velocidad = longitud de onda x frecuencia)\nPeriodo: T = 1/f\nSnell: n1*sin(O1) = n2*sin(O2)\nIndice refraccion: n = c/v  (c = 3x10^8 m/s)\nDoppler: f' = f*(v+-v_obs)/(v-+v_fuente)\nSonido en aire: ~343 m/s a 20C" }
    ],
    quimica: [
      { keys: ["acido", "base", "ph", "neutraliz"],
        val: "pH = -log10[H+]\npH + pOH = 14  (a 25C)\nKw = [H+][OH-] = 10^-14\n\nAcido: pH < 7\nNeutro: pH = 7\nBase: pH > 7\n\nAcidos fuertes: HCl, HBr, HNO3, H2SO4, HClO4\nBases fuertes: NaOH, KOH, Ca(OH)2\n\nHenderson-Hasselbalch: pH = pKa + log([A-]/[HA])" },
      { keys: ["mol", "estequio", "rendimiento", "masa molar"],
        val: "n = m / M  (moles = masa / masa molar)\nN = n x Na  (Na = 6.022x10^23)\nConcentracion: C = n/V [mol/L]\nDilucion: C1*V1 = C2*V2\nGas ideal: P*V = n*R*T\nRendimiento = (masa real / masa teorica) x 100%" },
      { keys: ["enlace", "ionico", "covalente", "electronega"],
        val: "Electronegatividad Pauling:\n  F(4.0) > O(3.5) > N(3.0) > Cl(3.2) > C(2.5)\n\nTipo de enlace por DEN:\n  DEN < 0.4  -> Covalente no polar\n  0.4-1.7    -> Covalente polar\n  DEN > 1.7  -> Ionico\n\nRegla del octeto: 8 electrones en capa de valencia\nGeometria VSEPR: 2 pares=lineal, 4 pares=tetraedrica" },
      { keys: ["oxida", "redox", "reduccion"],
        val: "OIL RIG: Oxidation Is Loss / Reduction Is Gain\nOxidacion: pierde electrones (sube N oxidacion)\nReduccion: gana electrones (baja N oxidacion)\n\nNormas N oxidacion:\n  O en compuestos = -2\n  H en compuestos = +1\n  Suma en neutro = 0\n\nE_celda = E_catodo - E_anodo\nSi E_celda > 0 -> reaccion espontanea" }
    ],
    matematicas: [
      { keys: ["derivada", "diferencial"],
        val: "Reglas basicas:\n  (c)' = 0\n  (x^n)' = n*x^(n-1)\n  (e^x)' = e^x\n  (ln x)' = 1/x\n  (sin x)' = cos x\n  (cos x)' = -sin x\n  (tan x)' = sec^2(x)\n\nReglas operacion:\n  (f*g)' = f'g + fg'    [producto]\n  (f/g)' = (f'g-fg')/g2 [cociente]\n  [f(g)]' = f'(g)*g'    [cadena]\n\nCriticos: f'(x)=0\nf''(x)>0 minimo | f''(x)<0 maximo" },
      { keys: ["integral", "integra", "primitiva"],
        val: "Integrales basicas:\n  INT(x^n)dx = x^(n+1)/(n+1) + C  (n != -1)\n  INT(1/x)dx = ln|x| + C\n  INT(e^x)dx = e^x + C\n  INT(sin x)dx = -cos x + C\n  INT(cos x)dx = sin x + C\n\nTeo. Fundamental: INT[a,b]f dx = F(b)-F(a)\nPor partes: INT u dv = uv - INT v du\nSustitucion: u = g(x)" },
      { keys: ["trigono", "seno", "coseno"],
        val: "Identidades pitagoricas:\n  sin2 + cos2 = 1\n  1 + tan2 = sec2\n\nAngulos especiales:\n  30: sin=0.5, cos=0.866, tan=0.577\n  45: sin=cos=0.707, tan=1\n  60: sin=0.866, cos=0.5, tan=1.732\n\nLey senos: a/sinA = b/sinB = c/sinC\nLey cosenos: c2 = a2+b2-2ab*cosC\n\nCuadrantes (+): QI todos | QII sin | QIII tan | QIV cos" },
      { keys: ["probabilidad", "estadist"],
        val: "P(A union B) = P(A)+P(B)-P(A inter B)\nP(A|B) = P(A inter B)/P(B)  [condicional]\nP(A inter B) = P(A)*P(B)  si independientes\n\nCombinaciones: C(n,r) = n!/[r!*(n-r)!]\nPermutaciones: P(n,r) = n!/(n-r)!\n\nNormal N(mu,sigma):\n  68% en [mu-sigma, mu+sigma]\n  95% en [mu-2sigma, mu+2sigma]\n  99.7% en [mu-3sigma, mu+3sigma]\n\nMedia: x_barra = suma(xi)/n" },
      { keys: ["limite", "continuid"],
        val: "Propiedades:\n  lim[f+-g] = lim f +- lim g\n  lim[f*g] = lim f * lim g\n\nLimites importantes:\n  lim(x->0) sin(x)/x = 1\n  lim(x->inf) (1+1/n)^n = e = 2.718\n\nL'Hopital: si lim f/g = 0/0 o inf/inf\n  -> lim f/g = lim f'/g'\n\nContinuidad en x=a:\n  1) f(a) existe\n  2) lim existe\n  3) lim = f(a)" }
    ],
    biologia: [
      { keys: ["celula", "organelo", "membrana", "mitosis"],
        val: "Tipos:\n  Procariota: sin nucleo (bacterias) 1-10 um\n  Eucariota: con nucleo (animales, plantas) 10-100 um\n\nOrganelos clave:\n  Mitocondria -> ATP (respiracion celular)\n  Ribosoma -> sintesis proteica\n  R. endoplasmico rugoso -> proteinas\n  R. endoplasmico liso -> lipidos\n  Aparato Golgi -> empaquetado\n  Cloroplasto -> fotosintesis (plantas)\n\nCiclo celular: G1 -> S -> G2 -> M (mitosis)\nMitosis: PROFASE -> METAFASE -> ANAFASE -> TELOFASE" },
      { keys: ["fotosint", "clorofila"],
        val: "Ecuacion global:\n  6CO2 + 6H2O + luz -> C6H12O6 + 6O2\n\nFase luminosa (tilacoides):\n  Fotolisis: 2H2O -> 4H+ + 4e- + O2\n  Produce: ATP + NADPH\n  Fotosistemas: PSII(680nm) -> PSI(700nm)\n\nCiclo de Calvin (estroma):\n  CO2 + RuBP -> 2 PGA (RuBisCO)\n  PGA + ATP + NADPH -> G3P\n  3 CO2 -> 1 G3P (= 1/2 glucosa)" },
      { keys: ["genetica", "adn", "arn", "gen", "herencia", "mendel"],
        val: "Dogma central:\n  ADN -> (Transcripcion) -> ARNm -> (Traduccion) -> Proteina\n\nBases ADN: A-T (2 H) | G-C (3 H)\nEn ARN: Uracilo(U) reemplaza Timina(T)\nCodon: 3 bases = 1 aminoacido\n64 codones | 61 codifican | 3 STOP\n\nLeyes Mendel:\n  1ra: Segregacion de alelos en meiosis\n  2da: Distribucion independiente\n\nAA: homocigoto dominante\nAa: heterocigoto (portador)\naa: homocigoto recesivo" }
    ],
    salud: [
      { keys: ["hipertension", "presion", "cardiov"],
        val: "Clasificacion (mmHg):\n  Normal: <120/<80\n  Elevada: 120-129/<80\n  HTA Grado 1: 130-139/80-89\n  HTA Grado 2: >=140/>=90\n  Crisis: >180/>120 (emergencia)\n\nFisiopatologia: PA = GC x RVP\n  GC: gasto cardiaco\n  RVP: resistencia vascular periferica\n\nReduccion PA sin farmacos:\n  Dieta DASH: -11 mmHg sistolica\n  Sal <5g/dia: -5 mmHg\n  Ejercicio 30min/dia: -5 mmHg\n  Perdida peso -5kg: -4 mmHg" },
      { keys: ["diabetes", "glucosa", "insulina"],
        val: "Criterios ADA 2024:\n  Glucosa ayunas >= 126 mg/dL (x2)\n  Glucosa 2h post-carga >= 200 mg/dL\n  HbA1c >= 6.5%\n  Glucosa aleatoria >= 200 + sintomas\n\nDM1 vs DM2:\n  DM1: autoinmune, insulinopenia absoluta\n  DM2: resistencia insulinica + deficit relativo\n\nMetas terapeuticas:\n  HbA1c < 7% | Glucosa ayunas 80-130 mg/dL\n  PA < 130/80 | LDL < 70 mg/dL" },
      { keys: ["inmun", "sistema inmune", "vacuna", "anticuerpo"],
        val: "Lineas de defensa:\n  1ra: barreras fisicas (piel, mucosas)\n  2da: inmunidad innata (macrofagos, NK)\n  3ra: inmunidad adaptativa (linfocitos B y T)\n\nInmunoglobulinas:\n  IgG(75%): memoria, cruza placenta\n  IgA: protege mucosas\n  IgM: respuesta primaria\n  IgE: alergias y parasitos\n\nVacunas:\n  Vivas atenuadas: MMR, varicela\n  Inactivadas: influenza, hepatitis A\n  ARNm: COVID-19" },
      { keys: ["nutricion", "vitamina", "dieta"],
        val: "Macronutrientes:\n  Carbohidratos: 4 kcal/g (50-60% dieta)\n  Proteinas: 4 kcal/g (10-15% dieta)\n  Grasas: 9 kcal/g (25-35% dieta)\n\nIMC = Peso(kg) / Talla(m)2\n  <18.5: bajo peso\n  18.5-24.9: normal\n  25-29.9: sobrepeso\n  30-34.9: obesidad I\n  >=40: obesidad III (morbida)\n\nVitaminas liposolubles: A, D, E, K\nVitaminas hidrosolubles: C, complejo B\nAgua recomendada: 2-3 L/dia adulto" }
    ]
  };

  var materiaDB = DB[mat] || [];
  for (var i = 0; i < materiaDB.length; i++) {
    var entry = materiaDB[i];
    for (var j = 0; j < entry.keys.length; j++) {
      if (t.indexOf(entry.keys[j]) !== -1) return entry.val;
    }
  }
  return null;
}

// ── EJERCICIOS ──
function getEjercicio(mat, tema, oraciones) {
  var t = tema.toLowerCase();
  var EJ = {
    fisica: [
      { keys: ["newton", "fuerza"],
        txt: "Problema: Un bloque de 8 kg tiene rozamiento uk=0.3 y se le aplica 50N horizontal. a=? (g=9.8)\n\nSolucion:\n1) W = mg = 8x9.8 = 78.4 N\n2) Normal N = 78.4 N\n3) Rozamiento fr = uk*N = 0.3x78.4 = 23.52 N\n4) F_neta = 50 - 23.52 = 26.48 N\n5) a = F_neta/m = 26.48/8\n\nResultado: a = 3.31 m/s2" },
      { keys: ["cinemat", "velocidad"],
        txt: "Problema: Proyectil lanzado horizontalmente desde 80m altura con v0=30 m/s. Tiempo de vuelo y distancia horizontal? (g=9.8)\n\nSolucion:\n1) Vertical (caida libre): h = (1/2)*g*t2\n   80 = (1/2)*9.8*t2\n   t2 = 160/9.8 = 16.33\n   t = 4.04 s\n\n2) Horizontal (MRU): x = v0*t = 30*4.04\n   x = 121.2 m\n\nResultado: Cae en 4.04s a 121.2m del lanzamiento" },
      { keys: ["energ", "trabajo"],
        txt: "Problema: Auto de 1200 kg sube 200m en pendiente 30 grados a velocidad constante. Trabajo del motor? (g=9.8)\n\nSolucion:\n1) Fuerza contra pendiente: F = m*g*sin30 = 1200*9.8*0.5 = 5880 N\n2) Velocidad constante -> F_motor = 5880 N\n3) W = F*d = 5880*200 = 1,176,000 J\n\nResultado: W = 1.176 MJ (igual al cambio en Ep)" }
    ],
    quimica: [
      { keys: ["acido", "base", "ph"],
        txt: "Problema: 50mL HCl 0.2M + 30mL NaOH 0.3M. pH resultante?\n\nSolucion:\n1) n(HCl) = 0.050*0.2 = 0.010 mol\n2) n(NaOH) = 0.030*0.3 = 0.009 mol\n3) Reaccion: HCl + NaOH -> NaCl + H2O\n   Exceso HCl = 0.010 - 0.009 = 0.001 mol\n4) Volumen total = 80 mL = 0.080 L\n5) [H+] = 0.001/0.080 = 0.0125 M\n6) pH = -log(0.0125) = 1.90\n\nResultado: pH = 1.90 (acido, exceso de HCl)" },
      { keys: ["mol", "estequio"],
        txt: "Problema: Combustion propano: C3H8 + 5O2 -> 3CO2 + 4H2O. Gramos CO2 con 44g propano? Rendimiento 85%?\n\nSolucion:\n1) M(C3H8) = 3(12)+8(1) = 44 g/mol\n   n(C3H8) = 44/44 = 1 mol\n2) 1 mol C3H8 -> 3 mol CO2\n3) M(CO2) = 44 g/mol\n   Teorico: 3*44 = 132 g CO2\n4) Con rendimiento 85%: 132*0.85 = 112.2 g\n\nResultado: 132g teorico, 112.2g real (85%)" }
    ],
    matematicas: [
      { keys: ["derivada", "diferencial"],
        txt: "Problema: C(x) = 0.01x3 - 0.6x2 + 15x + 100 (costo empresa). Costo marginal minimo?\n\nSolucion:\n1) Costo marginal: C'(x) = 0.03x2 - 1.2x + 15\n2) Minimizar: C''(x) = 0.06x - 1.2 = 0\n   x = 20 unidades\n3) Verificar minimo: C'''(x)=0.06>0 (minimo)\n4) C'(20) = 0.03(400) - 1.2(20) + 15\n          = 12 - 24 + 15 = 3\n\nResultado: Costo marginal minimo = 3 (mil $/ud) en x=20" },
      { keys: ["integral", "integra"],
        txt: "Problema: Area entre f(x)=x2 y g(x)=x+2.\n\nSolucion:\n1) Intersecciones: x2 = x+2 -> x2-x-2=0\n   (x-2)(x+1)=0 -> x=-1 y x=2\n2) En [-1,2]: g(x)>=f(x)\n3) Area = INT[-1,2] (x+2-x2) dx\n4) Antiderivada: x2/2 + 2x - x3/3\n   F(2) = 2+4-8/3 = 3.333\n   F(-1) = 0.5-2+0.333 = -1.167\n5) Area = 3.333-(-1.167) = 4.5\n\nResultado: Area = 4.5 unidades cuadradas" },
      { keys: ["trigono", "seno", "coseno"],
        txt: "Problema: Barco ve faro con angulo 28 grados. Al acercarse 50m el angulo es 46 grados. Altura del faro?\n\nSolucion:\n1) Sea h=altura, d=distancia inicial al pie\n   tan(28)=h/d -> d = h/0.5317\n   tan(46)=h/(d-50) -> d-50 = h/1.0355\n2) Restando: 50 = h/0.5317 - h/1.0355\n   50 = h*(1.881-0.966) = h*0.915\n3) h = 50/0.915 = 54.6 m\n\nResultado: Altura del faro = 54.6 metros" },
      { keys: ["probabilidad", "estadist"],
        txt: "Problema: Notas siguen N(mu=65, sigma=12). Que % aprueba con nota minima 50? En grupo de 80?\n\nSolucion:\n1) Z = (50-65)/12 = -1.25\n2) P(X>=50) = P(Z>=-1.25) = 1 - P(Z<-1.25)\n   Tabla Z: P(Z<-1.25) = 0.1056\n   P(X>=50) = 1 - 0.1056 = 0.8944\n3) Porcentaje: 89.44%\n4) En 80 estudiantes: 80*0.8944 = 71.5 aprox 72\n\nResultado: 89.4% aprueba, unos 72 de 80 estudiantes" }
    ],
    biologia: [
      { keys: ["genetica", "herencia", "mendel"],
        txt: "Problema: Hombre daltonico (XdY) x mujer portadora (XDXd). Hijos daltónicos?\n\nCuadro de Punnett:\n       XD      Xd\n  Xd   XDXd    XdXd\n  Y    XDY     XdY\n\nResultados:\n  XDXd (25%) = hija portadora (vision normal)\n  XdXd (25%) = hija DALTONICA\n  XDY  (25%) = hijo normal\n  XdY  (25%) = hijo DALTONICO\n\nResultado: 50% hijos varones seran daltónicos\n25% del total de descendencia sera daltonica" },
      { keys: ["fotosint", "celula"],
        txt: "Problema: Planta produce 180g glucosa. Cuantos litros CO2 consume y O2 libera?\n\nEcuacion: 6CO2 + 6H2O -> C6H12O6 + 6O2\n\nSolucion:\n1) M(glucosa) = 6(12)+12(1)+6(16) = 180 g/mol\n   n(glucosa) = 180/180 = 1 mol\n2) 1 mol glucosa -> 6 mol CO2 -> 6 mol O2\n3) Volumen a CNTP (22.4 L/mol):\n   V(CO2) = 6*22.4 = 134.4 L consumidos\n   V(O2) = 6*22.4 = 134.4 L liberados\n\nResultado: 134.4 litros de CO2 y O2 respectivamente" }
    ],
    salud: [
      { keys: ["hipertension", "presion"],
        txt: "Caso clinico: Hombre 58 años, PA 158/96 mmHg (3 mediciones), IMC 29.5, glucosa 108, fumador.\n\nAnalisis:\n1) PA 158/96 -> HTA Grado 2 (>=140/>=90)\n2) Factores de riesgo CV:\n   * Edad >= 55 (varon)\n   * Tabaquismo activo\n   * Sobrepeso (IMC 29.5)\n   * Glucosa 108 -> prediabetes\n   Total >= 3 factores = Riesgo CV ALTO\n3) Conducta:\n   * Farmacoterapia inmediata (IECA + Ca-antagonista)\n   * Meta PA: <130/80 mmHg\n   * Dejar tabaco, ejercicio, dieta DASH\n   * Monitorear glucosa (riesgo DM2)\n\nResultado: HTA Grado 2 con riesgo CV alto" },
      { keys: ["diabetes", "glucosa"],
        txt: "Caso clinico: Mujer 52 años, IMC 31.2, glucosa ayunas 138 mg/dL, HbA1c 7.8%, microalbuminuria +\n\nAnalisis:\n1) Diagnostico: DM tipo 2\n   Glucosa >=126 + HbA1c >=6.5% (criterios ADA)\n2) Complicacion: nefropatia diabetica incipiente\n3) Plan terapeutico (ADA 2024):\n   * Metformina 500mg c/12h (aumentar progresivo)\n   * IECA o ARA-II (nefroproteccion)\n   * Si HbA1c no mejora: agregar SGLT2i\n   * Dieta: deficit 500 kcal/dia\n   * Ejercicio: 150 min/semana aerobico\n4) Metas: HbA1c<7%, PA<130/80, LDL<70\n\nResultado: DM2 + nefropatia. Metformina + IECA + estilo de vida" }
    ]
  };

  var materiaEJ = EJ[mat] || [];
  for (var i = 0; i < materiaEJ.length; i++) {
    var entry = materiaEJ[i];
    for (var j = 0; j < entry.keys.length; j++) {
      if (t.indexOf(entry.keys[j]) !== -1) return entry.txt;
    }
  }
  var o1 = "";
  var o2 = "";
  for (var k = 0; k < oraciones.length; k++) {
    if (!o1 && oraciones[k].length > 70 && oraciones[k].length < 250) o1 = oraciones[k];
    if (!o2 && k > 3 && oraciones[k].length > 70 && oraciones[k].length < 250) o2 = oraciones[k];
    if (o1 && o2) break;
  }
  return "Ejercicio sobre \"" + tema + "\":\n\nPregunta: Cual es el principio fundamental de este tema?\nRespuesta: " + o1.slice(0, 240) + "\n\nPregunta 2: Aplicacion practica?\n" + o2.slice(0, 240) + "\n\nNota: Escribe un tema mas especifico para ejercicios numericos detallados.";
}

// ── EJEMPLOS ──
function getEjemplos(mat, tema) {
  var t = tema.toLowerCase();
  var EX = {
    fisica: [
      { keys: ["newton", "fuerza"],
        txt: "1) Airbags: Aumentan tiempo de colision ~10x. Por F=Dp/Dt, la fuerza se reduce 10 veces protegiendo organos vitales.\n\n2) Cohetes Falcon 9: Por 3ra Ley, expulsan gas a 3000 m/s generando 7.6 MN de empuje hacia arriba.\n\n3) Biomecánica deportiva: Un penalti aplica ~1500N durante 8ms imprimiendo ~120 km/h al balon.\n\n4) Ingenieria civil: Los puentes se disenan considerando que cada apoyo reacciona con fuerza igual a la carga que soporta." },
      { keys: ["energ", "trabajo"],
        txt: "1) Central hidroelectrica Itaipu: Convierte Ep del agua en 14 GW de electricidad. Abastece 17% de Brasil y 73% de Paraguay.\n\n2) Freno regenerativo (EVs): Al frenar, el motor actua como generador recuperando hasta 70% de la energia cinetica en baterias.\n\n3) Panel solar 400W: En 5h de sol pico genera 2 kWh, suficiente para 4h de aire acondicionado.\n\n4) Montana rusa: Disenada con conservacion de energia. Altura inicial determina velocidad maxima: v = raiz(2gh)." }
    ],
    quimica: [
      { keys: ["acido", "base", "ph"],
        txt: "1) Caries dental: Bacterias S.mutans producen acido lactico (pH<5.5) disolviendo hidroxiapatita del esmalte.\n\n2) Lluvia acida: SO2 y NOx forman H2SO4 y HNO3 en atmosfera. pH puede llegar a 4.0-4.5 danando ecosistemas acuaticos.\n\n3) Tampón bicarbonato en sangre: Mantiene pH sanguineo 7.35-7.45. Desviacion de 0.4 puede ser fatal.\n\n4) Champu: pH 4.5-5.5 protege cuero cabelludo y evita esponjamiento de la cuticula del cabello." }
    ],
    matematicas: [
      { keys: ["derivada", "diferencial"],
        txt: "1) Finanzas (Black-Scholes): La derivada del precio de una opcion (Delta) determina la cobertura de riesgo. Premio Nobel Economia 1997.\n\n2) Epidemiologia: dI/dt = B*S*I - y*I (modelo SIR). Si R0=B/y>1 hay epidemia. La derivada determina si crece o decrece.\n\n3) Tesla Autopilot: Calcula curvatura k=|y''|/(1+y'^2)^(3/2) de la carretera en tiempo real para ajustar direccion.\n\n4) Forense: Ley de enfriamiento T(t)=T_amb+(T0-T_amb)*e^(-kt) estima hora de muerte." },
      { keys: ["integral", "integra"],
        txt: "1) Ingenieria civil: Momentos de inercia I=INT(y^2 dA) determinan rigidez de vigas. El puente Golden Gate soporta 18,000 ton.\n\n2) Farmacologia: AUC (Area Bajo la Curva = INT C(t)dt) mide exposicion total del organismo a un farmaco.\n\n3) Capacitores: Carga Q = INT I(t)dt. Supercondensadores de 500F arrancan buses electricos.\n\n4) Oceanografia: Corriente del Golfo transporta INT INT v*dA = 30 Sverdrup (30 millones de m3/s)." },
      { keys: ["probabilidad", "estadist"],
        txt: "1) Seguros: Calculan primas segun probabilidades de accidentes, enfermedades y siniestros usando estadistica actuarial.\n\n2) Control calidad: Grafico Shewhart usa +/-3sigma. Probabilidad de falsa alarma = 0.27% (Regla 99.73%).\n\n3) Machine Learning: Netflix y Spotify usan Teorema de Bayes P(A|B)=P(B|A)*P(A)/P(B) para recomendaciones.\n\n4) Genómica: Hardy-Weinberg p^2+2pq+q^2=1 predice frecuencia de enfermedades geneticas en poblaciones." }
    ],
    biologia: [
      { keys: ["celula"],
        txt: "1) Terapia CAR-T: Linfocitos T modificados geneticamente reconocen celulas cancerosas. Remision >80% en leucemia linfoblastica aguda.\n\n2) Celulas madre (2023): Paciente DM1 trato con celulas beta-pancreaticas derivadas de celulas madre, produciendo insulina >1 año.\n\n3) Carne cultivada: Celulas musculares en biorreactores. Reduciria emisiones agropecuarias en 92% sin sacrificio animal.\n\n4) PCR: Amplifica ADN celular millones de veces en horas. Base del diagnostico COVID-19, VIH y pruebas de paternidad." },
      { keys: ["genetica"],
        txt: "1) CRISPR-Cas9 (Nobel 2020): Primer terapia aprobada (Casgevy 2023) para anemia falciforme edita ADN de celulas madre.\n\n2) Arroz dorado: Gen de betacarotenogenesis insertado; podria prevenir deficiencia vitamina A en 250 millones de personas.\n\n3) Proyecto Genoma Humano (2003): 3.2 mil millones de pares de bases. Hoy secuenciar un genoma completo cuesta <$1000 en 24h.\n\n4) Forense STR: Analiza 20 regiones ADN con probabilidad de error 1 en 10^18. Mas confiable que huellas dactilares." }
    ],
    salud: [
      { keys: ["hipertension", "presion"],
        txt: "1) Adherencia terapeutica: Solo 50% de hipertensos adheridos logran control. La falta de adherencia causa 10.5 millones de muertes CV/año (OMS 2022).\n\n2) Estudio INTERSALT (32 paises): Reducir 6g/dia de sal baja PA 3.5 mmHg -> reduce infartos 14% y ACV 20%.\n\n3) Ejercicio (metaanalisis 2023, 391 estudios): Aerobico reduce PA sistolica -4.49 mmHg, comparable a algunos farmacos.\n\n4) Telemedicina: Tensiómetros Bluetooth + IA reducen HTA no controlada 35% (Estudio TASMIN-SR, UK)." },
      { keys: ["diabetes", "glucosa"],
        txt: "1) Insulina biosintética (1982): Antes de Humulin se usaba insulina porcina/bovina con mas efectos adversos. Hoy >30 tipos disponibles.\n\n2) Monitor continuo CGM (FreeStyle Libre): Mide glucosa cada minuto sin puncion. Pancreas artificial reduce HbA1c 0.5% y hipoglucemia 40%.\n\n3) Microbioma y DM2: Menos Akkermansia en DM2. Trasplante microbiota fecal mejora sensibilidad insulinica en estudios piloto.\n\n4) Farmacogenómica: Variante TCF7L2 aumenta 40% riesgo DM2. Los polimorfismos en SLC22A1 determinan eficacia de metformina." },
      { keys: ["inmun", "sistema inmune", "vacuna"],
        txt: "1) Vacunas ARNm COVID: Pfizer-BioNTech con nanoparticulas lipidicas. Eficacia >94% contra enfermedad severa. Ahora en desarrollo para VIH y cancer.\n\n2) Inmunoterapia oncologica: Anti-PD1/PD-L1 (pembrolizumab). Sobrevida 5 años en melanoma avanzado: de <10% a >40%.\n\n3) Alergias: Inmunoterapia sublingual reprograma respuesta Th2->Th1, reduciendo sintomas 85% tras 3 años.\n\n4) Lactancia materna: IgA secretora + lactoferrina reducen infecciones respiratorias 72% y diarreas 64% en lactantes (OPS 2022)." }
    ]
  };

  var materiaEX = EX[mat] || [];
  for (var i = 0; i < materiaEX.length; i++) {
    var entry = materiaEX[i];
    for (var j = 0; j < entry.keys.length; j++) {
      if (t.indexOf(entry.keys[j]) !== -1) return entry.txt;
    }
  }
  return "1) \"" + tema + "\" se aplica en investigacion cientifica y tecnologia de vanguardia.\n2) Profesionales de la salud, ingenieria y ciencias usan estos conceptos diariamente.\n3) Escribe un tema mas especifico para obtener ejemplos con datos y estudios reales.";
}
