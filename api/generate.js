export default async function handler(req, res) {
  // Solo POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // CORS — permite tu dominio en producción
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const { materia, tema, tipo } = req.body;

  if (!materia || !tema || !tipo) {
    return res.status(400).json({ error: "Faltan parámetros: materia, tema, tipo" });
  }

  // La API key vive en Vercel Environment Variables — nunca en el código
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key no configurada en el servidor" });
  }

  const NOMBRES = {
    fisica: "Física",
    quimica: "Química",
    matematicas: "Matemáticas",
    biologia: "Biología",
    salud: "Ciencias de la Salud",
  };

  const instrucciones = {
    todo: `Genera para WhatsApp:
1) 📚 RESUMEN (5 puntos clave, concisos)
2) 🔣 CONCEPTOS / FÓRMULAS principales (con significado de variables)
3) ✏️ EJERCICIO RESUELTO paso a paso (1 ejemplo)
4) 💡 DATO CURIOSO o aplicación real
Separa secciones con ══════════════`,
    resumen: `Genera un resumen de 6 puntos clave muy claros para WhatsApp. Máximo 180 palabras.`,
    ejercicios: `Genera 3 ejercicios resueltos paso a paso. Numera con 1️⃣ 2️⃣ 3️⃣. Muestra procedimiento completo.`,
    formulas: `Lista fórmulas, leyes y conceptos clave. Explica qué significa cada variable o término.`,
    ejemplos: `Da 3 ejemplos prácticos reales en la vida cotidiana. Explica cada uno de forma sencilla.`,
  };

  const prompt = `Eres el tutor experto de la Academia MY 10, especialista en ${NOMBRES[materia]}. Tema: "${tema}".

${instrucciones[tipo]}

FORMATO OBLIGATORIO para WhatsApp:
• Título atractivo con emoji al inicio
• ✅ para puntos importantes
• 📌 para definiciones o leyes
• ⚠️ para errores comunes
• Lenguaje claro, preciso y amigable
• Máximo 380 palabras
• Termina con: "📲 *Academia MY 10* — ¡Todo por WhatsApp! 🏆"
• Información 100% correcta y confiable`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || "Error de API" });
    }

    const data = await response.json();
    const texto = data.content?.[0]?.text || "";

    return res.status(200).json({ texto });
  } catch (error) {
    console.error("Error llamando a Anthropic:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}
