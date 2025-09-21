// === extractFilters.js ===
async function extractFilters(model, prompt) {
  const extractionPrompt = `Extract filters (budget, type, brand) from: "${prompt}". 
    - If user mentions price range, map it to budget.
    - If they mention car style (SUV, sedan, hatchback, etc.), map it to type.
    - If they mention a company (Hyundai, Tata, Maruti, Honda, etc.), map it to brand.
    - The message may contain spelling mistakes or typos. Normalize them and map to the closest valid brand, type, or budget value.
    Return only structured JSON with keys: {"budget": "string|null", "type": "string|null", "brand": "string|null"}`;

  try {
    const response = await model.generateContent(extractionPrompt);
    const text = response.response.text();
    
    // Extract JSON from response
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s !== -1 && e !== -1) {
      return JSON.parse(text.slice(s, e + 1));
    }
    
    return { budget: null, type: null, brand: null };
  } catch (error) {
    console.error("Error extracting filters:", error.message);
    return { budget: null, type: null, brand: null };
  }
}

module.exports = { extractFilters };
