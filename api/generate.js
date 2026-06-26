export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { materia, tema, tipo } = req.body || {};
  if (!materia || !tema || !tipo) return res.status(400).json({ error: "Faltan parámetros" });

  try {
    // 1. Buscar en Wikipedia en español
    const wikiSearch = await fetch(
      `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(tema)}`,
      { headers: { "User-Agent": "AcademiaMY10/1.0" } }
    );

    let wikiData = null;
    if (wikiSearch.ok) {
      wikiData = await wikiSearch.json();
    } else {
      // Fallback: buscar por texto libre
      const wikiQuery = await fetch(
        `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(tema + " " + materia)}&format=json&utf8=1&srlimit=3&origin=*`
      );
      const wqData = await wikiQuery.json();
      const firstResult = wqData?.query?.search?.[0];
      if (firstResult) {
        const wikiPage = await fetch(
          `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(firstResult.title)}`,
          { headers: { "User-Agent": "AcademiaMY10/1.0" } }
        );
        if (wikiPage.ok) wikiData = await wikiPage.json();
      }
    }

    // 2. Buscar secciones completas de Wikipedia
    let secciones = "";
    if (wikiData?.title) {
      const wikiSections = await fetch(
        `https://es.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(wikiData.title)}&prop=sections|text&format=json&origin=*`
      );
      if (wikiSections.ok) {
        const wsData = await wikiSections.json();
        const sections = wsData?.parse?.sections?.slice(0, 6) || [];
        secciones = sections.map(s => s.line).join(", ");
      }
    }

    // 3. Buscar definiciones en Wiktionary
    let definicion = "";
    const wiktFetch = await fetch(
      `https://es.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(tema)}`,
      { headers: { "User-Agent": "AcademiaMY10/1.0" } }
    );
    if (wiktFetch.ok) {
      const wiktData = await wiktFetch.json();
      const defs = wiktData?.es?.[0]?.definitions?.slice(0, 2) || [];
      definicion = defs.map(d => d.definition?.replace(/<[^>]+>/g, '') || '').join(". ");
    }

    // 4. Buscar en Wikipedia inglés si el español es muy corto
    let wikiEnData = null;
    if (!wikiData?.extract || wikiData.extract.length < 200) {
      const wikiEn = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(tema)}`,
        { headers: { "User-Agent": "AcademiaMY10/1.0" } }
      );
      if (wikiEn.ok) wikiEnData = await wikiEn.json();
    }

    // Construir el texto base
    const extractoBase = wikiData?.extract || wikiEnData?.extract || "";
    const tituloWiki = wikiData?.title || wikiEnData?.title || tema;
    const urlWiki = wikiData?.content_urls?.desktop?.page || `https://es.wikipedia.org/wiki/${encodeURIComponent(tema)}`;

    // 5. Construir respuesta formateada para WhatsApp
    const NOMBRES = {
      fisica: "Física", quimica: "Química", matematicas: "Matemáticas",
      biologia: "Biología", salud: "Ciencias de la Salud"
    };
    const EMOJIS = { fisica: "⚛️", quimica: "🧪", matematicas: "📐", biologia: "🌿", salud: "🩺" };
    const matNombre = NOMBRES[materia] || materia;
    const matEmoji = EMOJIS[materia] || "📚";

    let texto = "";

    if (tipo === "resumen" || tipo === "todo") {
      texto += `${matEmoji} *${tituloWiki.toUpperCase()}*\n`;
      texto += `📚 ${matNombre} — Academia MY 10\n`;
      texto += `══════════════════════\n\n`;
      texto += `📌 *¿Qué es?*\n`;

      if (definicion) {
        texto += `✅ ${definicion.slice(0, 300)}\n\n`;
      }

      if (extractoBase) {
        // Dividir el extracto en puntos clave (cada oración)
        const oraciones = extractoBase
          .replace(/\n+/g, ' ')
          .split(/(?<=[.!?])\s+/)
          .filter(o => o.length > 30)
          .slice(0, 5);

        texto += `📋 *Puntos clave:*\n`;
        oraciones.forEach((o, i) => {
          texto += `✅ ${o.trim()}\n`;
        });
      }

      if (secciones) {
        texto += `\n🗂️ *Temas relacionados:* ${secciones}\n`;
      }
    }

    if (tipo === "formulas" || tipo === "todo") {
      texto += `\n══════════════════════\n`;
      texto += `🔣 *CONCEPTOS Y FÓRMULAS CLAVE*\n\n`;

      const formulas = getFormulas(materia, tema);
      if (formulas) {
        texto += formulas;
      } else if (extractoBase) {
        const conceptos = extractoBase
          .replace(/\n+/g, ' ')
          .split(/(?<=[.!?])\s+/)
          .filter(o => o.length > 20)
          .slice(2, 5);
        conceptos.forEach(c => { texto += `📌 ${c.trim()}\n`; });
      }
    }

    if (tipo === "ejercicios" || tipo === "todo") {
      texto += `\n══════════════════════\n`;
      texto += `✏️ *EJERCICIO RESUELTO*\n\n`;
      const ejercicio = getEjercicio(materia, tema, extractoBase);
      texto += ejercicio;
    }

    if (tipo === "ejemplos" || tipo === "todo") {
      texto += `\n══════════════════════\n`;
      texto += `💡 *APLICACIÓN EN LA VIDA REAL*\n\n`;
      const ejemplos = getEjemplos(materia, tema, extractoBase);
      texto += ejemplos;
    }

    texto += `\n══════════════════════\n`;
    texto += `🌐 *Fuente:* ${urlWiki}\n`;
    texto += `📲 *Academia MY 10* — ¡Todo por WhatsApp! 🏆`;

    return res.status(200).json({ texto, fuente: urlWiki, titulo: tituloWiki });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno: " + err.message });
  }
}

// Fórmulas y conceptos por materia/tema
function getFormulas(materia, tema) {
  const t = tema.toLowerCase();
  const db = {
    fisica: {
      "newton": `📌 *1ª Ley (Inercia):* Un objeto en reposo permanece en reposo si no actúa fuerza neta.\n📌 *2ª Ley (F=ma):* Fuerza = masa × aceleración\n📌 *3ª Ley (Acción-Reacción):* Por cada acción hay una reacción igual y opuesta.\n⚠️ La masa se mide en kg, la fuerza en Newton (N)`,
      "cinematica": `📌 *v = v₀ + at* (velocidad final)\n📌 *x = v₀t + ½at²* (posición)\n📌 *v² = v₀² + 2ax* (sin tiempo)\n📌 *v_media = Δx/Δt* (velocidad media)\n⚠️ Usa siempre unidades del SI: m, s, m/s`,
      "energia": `📌 *Ec = ½mv²* (energía cinética)\n📌 *Ep = mgh* (energía potencial)\n📌 *W = F·d·cos θ* (trabajo)\n📌 *P = W/t* (potencia en Watts)`,
      "termodinamica": `📌 *ΔU = Q - W* (1ª Ley)\n📌 *η = 1 - Tc/Th* (eficiencia Carnot)\n📌 *PV = nRT* (gas ideal)\n📌 *R = 8.314 J/mol·K*`,
      "electromagnetismo": `📌 *F = kq₁q₂/r²* (Coulomb)\n📌 *V = IR* (Ohm)\n📌 *P = VI = I²R* (potencia)\n📌 *k = 9×10⁹ N·m²/C²*`,
    },
    quimica: {
      "acido": `📌 *pH = -log[H⁺]*\n📌 *pH + pOH = 14*\n📌 Ácido: pH < 7  |  Base: pH > 7  |  Neutro: pH = 7\n⚠️ Ácidos fuertes: HCl, H₂SO₄, HNO₃`,
      "estequiometria": `📌 *n = m/M* (moles = masa/masa molar)\n📌 *PV = nRT* (gas ideal)\n📌 *Rendimiento = (real/teórico)×100%*\n⚠️ Balancear siempre la ecuación antes de calcular`,
      "enlace": `📌 *Iónico:* metal + no metal (NaCl)\n📌 *Covalente:* no metal + no metal (H₂O)\n📌 *Metálico:* metal + metal\n📌 *Electronegatividad:* F > O > N > Cl`,
    },
    matematicas: {
      "derivada": `📌 *(xⁿ)' = nxⁿ⁻¹*\n📌 *(sin x)' = cos x*\n📌 *(cos x)' = -sin x*\n📌 *(eˣ)' = eˣ*\n📌 *(ln x)' = 1/x*\n📌 *Regla cadena: [f(g(x))]' = f'(g(x))·g'(x)*`,
      "integral": `📌 *∫xⁿdx = xⁿ⁺¹/(n+1) + C*\n📌 *∫sin x dx = -cos x + C*\n📌 *∫eˣdx = eˣ + C*\n📌 *∫(1/x)dx = ln|x| + C*\n⚠️ No olvides la constante C en integrales indefinidas`,
      "trigonometria": `📌 *sin²θ + cos²θ = 1*\n📌 *tan θ = sin θ/cos θ*\n📌 *sin(A+B) = sinA·cosB + cosA·sinB*\n📌 *Ley senos: a/sinA = b/sinB*`,
    },
    biologia: {
      "celula": `📌 *Célula procariota:* sin núcleo definido (bacterias)\n📌 *Célula eucariota:* con núcleo (animales, plantas)\n📌 *Membrana:* bicapa lipídica con proteínas\n📌 *ATP:* moneda energética de la célula`,
      "genetica": `📌 *ADN → ARNm → Proteína* (Dogma central)\n📌 *Genotipo:* genes que posee el individuo\n📌 *Fenotipo:* características visibles\n📌 *Dominante (A)* sobre recesivo (a)\n📌 *Leyes de Mendel:* segregación e independencia`,
    },
    salud: {
      "hipertension": `📌 *Normal:* <120/80 mmHg\n📌 *Elevada:* 120-129/<80 mmHg\n📌 *HTA grado 1:* 130-139/80-89 mmHg\n📌 *HTA grado 2:* ≥140/≥90 mmHg\n⚠️ Factores: sal, estrés, sedentarismo, genética`,
      "diabetes": `📌 *Glucosa normal:* 70-100 mg/dL (ayunas)\n📌 *Prediabetes:* 100-125 mg/dL\n📌 *Diabetes:* ≥126 mg/dL (2 mediciones)\n📌 *HbA1c objetivo:* <7% en diabéticos\n⚠️ Tipo 1: autoinmune | Tipo 2: resistencia insulina`,
    }
  };

  const materiaDB = db[materia] || {};
  for (const key of Object.keys(materiaDB)) {
    if (t.includes(key)) return materiaDB[key];
  }
  return null;
}

// Ejercicio resuelto según materia
function getEjercicio(materia, tema, extracto) {
  const t = tema.toLowerCase();

  if (materia === "fisica") {
    if (t.includes("newton") || t.includes("fuerza")) {
      return `*Problema:* Un auto de 1000 kg acelera a 3 m/s². ¿Qué fuerza neta actúa?\n\n*Solución:*\n1️⃣ Datos: m = 1000 kg, a = 3 m/s²\n2️⃣ Fórmula: F = m × a\n3️⃣ Cálculo: F = 1000 × 3 = *3000 N*\n\n✅ La fuerza neta es 3000 Newton.`;
    }
    if (t.includes("cinematica") || t.includes("velocidad")) {
      return `*Problema:* Un objeto parte del reposo y acelera a 5 m/s² por 4 segundos. ¿Qué distancia recorre?\n\n*Solución:*\n1️⃣ Datos: v₀=0, a=5 m/s², t=4 s\n2️⃣ Fórmula: x = v₀t + ½at²\n3️⃣ Cálculo: x = 0 + ½(5)(16) = *40 metros*\n\n✅ El objeto recorre 40 metros.`;
    }
    if (t.includes("energia") || t.includes("trabajo")) {
      return `*Problema:* Una caja de 10 kg cae desde 5 m. ¿Cuál es su energía cinética al llegar al suelo?\n\n*Solución:*\n1️⃣ Ep inicial = mgh = 10 × 9.8 × 5 = 490 J\n2️⃣ Por conservación de energía: Ec = Ep = *490 J*\n3️⃣ Velocidad: v = √(2Ec/m) = √98 ≈ *9.9 m/s*\n\n✅ Energía cinética = 490 Joules.`;
    }
  }

  if (materia === "quimica") {
    if (t.includes("acido") || t.includes("ph")) {
      return `*Problema:* Calcula el pH de HCl 0.01 M.\n\n*Solución:*\n1️⃣ HCl es ácido fuerte → se disocia completamente\n2️⃣ [H⁺] = 0.01 M = 10⁻² M\n3️⃣ pH = -log(10⁻²) = *2*\n\n✅ El pH de la solución es 2 (ácido fuerte).`;
    }
    if (t.includes("estequiometria") || t.includes("mol")) {
      return `*Problema:* ¿Cuántos gramos de H₂O se producen con 4g de H₂?\n\n*Solución:*\n1️⃣ Reacción: 2H₂ + O₂ → 2H₂O\n2️⃣ Moles H₂ = 4g ÷ 2 g/mol = 2 mol\n3️⃣ Relación 1:1 → 2 mol H₂O\n4️⃣ Masa = 2 mol × 18 g/mol = *36 gramos*\n\n✅ Se producen 36 gramos de agua.`;
    }
  }

  if (materia === "matematicas") {
    if (t.includes("derivada")) {
      return `*Problema:* Deriva f(x) = 3x⁴ - 2x² + 5x - 1\n\n*Solución:*\n1️⃣ Derivar término a término\n2️⃣ (3x⁴)' = 12x³\n3️⃣ (-2x²)' = -4x\n4️⃣ (5x)' = 5\n5️⃣ (-1)' = 0\n\n✅ *f'(x) = 12x³ - 4x + 5*`;
    }
    if (t.includes("integral")) {
      return `*Problema:* Calcula ∫(2x + 3)dx\n\n*Solución:*\n1️⃣ Integrar término a término\n2️⃣ ∫2x dx = x² \n3️⃣ ∫3 dx = 3x\n4️⃣ Agregar constante C\n\n✅ *Resultado: x² + 3x + C*`;
    }
    if (t.includes("trigonometria") || t.includes("triángulo")) {
      return `*Problema:* En un triángulo rectángulo, hipotenusa=10, cateto=6. ¿Cuánto mide el otro cateto?\n\n*Solución:*\n1️⃣ Teorema de Pitágoras: a² + b² = c²\n2️⃣ 6² + b² = 10²\n3️⃣ b² = 100 - 36 = 64\n4️⃣ b = √64 = *8*\n\n✅ El cateto mide 8 unidades.`;
    }
  }

  // Ejercicio genérico basado en el extracto
  const oraciones = extracto?.split(/(?<=[.!?])\s+/).filter(o => o.length > 40).slice(0, 2) || [];
  return `*Ejercicio de comprensión sobre "${tema}":*\n\n❓ ¿Cuál es el concepto principal de este tema?\n\n*Respuesta:*\n✅ ${oraciones[0] || 'Consulta tu libro de texto para ejercicios específicos.'}\n\n💡 ${oraciones[1] || 'Practica resumiendo el tema en tus propias palabras.'}`;
}

// Ejemplos prácticos de la vida real
function getEjemplos(materia, tema, extracto) {
  const t = tema.toLowerCase();

  if (materia === "fisica") {
    if (t.includes("newton")) return `🚗 *Ejemplo 1:* Cuando un auto frena bruscamente, tu cuerpo sigue hacia adelante (1ª Ley).\n🚀 *Ejemplo 2:* Un cohete expulsa gas hacia abajo y sube hacia arriba (3ª Ley).\n⚽ *Ejemplo 3:* Patear un balón: más fuerza = mayor aceleración (2ª Ley).`;
    if (t.includes("energia")) return `💡 *Ejemplo 1:* Una presa hidroeléctrica convierte energía potencial del agua en electricidad.\n🎢 *Ejemplo 2:* Una montaña rusa transforma Ep en Ec al bajar.\n🔋 *Ejemplo 3:* Una batería convierte energía química en eléctrica.`;
  }
  if (materia === "quimica") {
    if (t.includes("acido")) return `🍋 *Ejemplo 1:* El limón tiene pH ~2 (ácido cítrico) — por eso es ácido.\n🧴 *Ejemplo 2:* El jabón tiene pH ~9-10 (básico) — limpia la grasa.\n🩸 *Ejemplo 3:* La sangre humana tiene pH 7.4 (levemente básico).`;
    if (t.includes("quimica") || t.includes("reaccion")) return `🍞 *Ejemplo 1:* Hornear pan = reacción química (levadura + azúcar → CO₂).\n🦷 *Ejemplo 2:* Las caries son desmineralización ácida del esmalte dental.\n🔥 *Ejemplo 3:* La combustión de gasolina mueve los autos.`;
  }
  if (materia === "matematicas") {
    if (t.includes("derivada")) return `📈 *Ejemplo 1:* La velocidad de un auto es la derivada de su posición respecto al tiempo.\n💹 *Ejemplo 2:* En economía, el costo marginal es la derivada del costo total.\n🌡️ *Ejemplo 3:* La tasa de enfriamiento de un café = derivada de temperatura.`;
    if (t.includes("probabilidad")) return `🎲 *Ejemplo 1:* Probabilidad de sacar cara en una moneda = 50%.\n⚽ *Ejemplo 2:* Un equipo con 70% de victorias tiene alta probabilidad de ganar.\n🏥 *Ejemplo 3:* Las aseguradoras calculan primas con probabilidades de accidentes.`;
  }
  if (materia === "biologia") {
    if (t.includes("celula")) return `🧫 *Ejemplo 1:* Tu piel se renueva cada 2-4 semanas gracias a la división celular.\n🦠 *Ejemplo 2:* Las bacterias (procariotas) causan infecciones curables con antibióticos.\n🌱 *Ejemplo 3:* Las plantas tienen cloroplastos en sus células para hacer fotosíntesis.`;
    if (t.includes("fotosintesis")) return `🌿 *Ejemplo 1:* Las plantas absorben CO₂ y liberan O₂ — nos dan el aire que respiramos.\n🌽 *Ejemplo 2:* Los cultivos convierten luz solar en alimento (trigo, maíz, arroz).\n🐠 *Ejemplo 3:* El fitoplancton oceánico produce el 50% del oxígeno de la Tierra.`;
  }
  if (materia === "salud") {
    if (t.includes("hipertension")) return `🧂 *Ejemplo 1:* Reducir sal a <5g/día puede bajar la presión hasta 5 mmHg.\n🚶 *Ejemplo 2:* Caminar 30 min diarios reduce el riesgo cardiovascular en 35%.\n😰 *Ejemplo 3:* El estrés crónico activa el sistema simpático y sube la presión.`;
    if (t.includes("diabetes")) return `🥗 *Ejemplo 1:* Una dieta baja en carbohidratos simples estabiliza la glucosa.\n🏃 *Ejemplo 2:* El ejercicio aumenta la sensibilidad a la insulina.\n📊 *Ejemplo 3:* El monitoreo glucémico diario previene complicaciones graves.`;
  }

  return `🌍 *Ejemplo 1:* El tema "${tema}" se aplica en investigación científica y tecnología moderna.\n🏫 *Ejemplo 2:* Los estudiantes de ${materia} usan estos conceptos en laboratorios y proyectos reales.\n💼 *Ejemplo 3:* Profesionales de la salud, ingeniería y ciencias usan este conocimiento diariamente.`;
}
