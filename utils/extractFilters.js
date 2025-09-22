// === extractFilters.js ===
async function extractFilters(model, prompt) {
  const extractionPrompt = `Extract filters (budget, type, brand) from: "${prompt}". 

VALID OPTIONS:
- Budget: "Under ₹5L", "₹5-10L", "₹10-15L", "₹15-20L", "Above ₹20L"
- Type: "SUV", "Sedan", "Hatchback", "MUV", "Coupe", "Convertible", "Wagon", "Pickup"
- Brand: "Hyundai", "Maruti", "Tata", "Honda", "Toyota", "Mahindra", "Kia", "Nissan", "Ford", "Volkswagen"

MAPPING RULES:
- "low budget" or "low" → "Under ₹5L"
- "medium budget" → "₹5-10L" 
- "high budget" → "Above ₹20L"
- "sedan" → "Sedan"
- "suv" → "SUV"
- "hatchback" → "Hatchback"
- "muv" → "MUV"
- Normalize company names to exact brand names

Return only structured JSON with keys: {"budget": "string|null", "type": "string|null", "brand": "string|null"}`;

  try {
    const response = await model.generateContent(extractionPrompt);
    const text = response.response.text();
    
    // Extract JSON from response
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s !== -1 && e !== -1) {
      const extracted = JSON.parse(text.slice(s, e + 1));
      
      // Validate and normalize extracted values
      const validBudget = ["Under ₹5L", "₹5-10L", "₹10-15L", "₹15-20L", "Above ₹20L"];
      const validType = ["SUV", "Sedan", "Hatchback", "MUV", "Coupe", "Convertible", "Wagon", "Pickup"];
      const validBrand = ["Hyundai", "Maruti", "Tata", "Honda", "Toyota", "Mahindra", "Kia", "Nissan", "Ford", "Volkswagen"];
      
      // Normalize budget
      if (extracted.budget && !validBudget.includes(extracted.budget)) {
        const budgetLower = extracted.budget.toLowerCase();
        if (budgetLower.includes('low')) extracted.budget = "Under ₹5L";
        else if (budgetLower.includes('medium')) extracted.budget = "₹5-10L";
        else if (budgetLower.includes('high')) extracted.budget = "Above ₹20L";
        else extracted.budget = null;
      }
      
      // Normalize type
      if (extracted.type && !validType.includes(extracted.type)) {
        const typeLower = extracted.type.toLowerCase();
        if (typeLower.includes('sedan')) extracted.type = "Sedan";
        else if (typeLower.includes('suv')) extracted.type = "SUV";
        else if (typeLower.includes('hatchback')) extracted.type = "Hatchback";
        else if (typeLower.includes('muv')) extracted.type = "MUV";
        else extracted.type = null;
      }
      
      // Normalize brand
      if (extracted.brand && !validBrand.includes(extracted.brand)) {
        const brandLower = extracted.brand.toLowerCase();
        if (brandLower.includes('hyundai')) extracted.brand = "Hyundai";
        else if (brandLower.includes('maruti')) extracted.brand = "Maruti";
        else if (brandLower.includes('tata')) extracted.brand = "Tata";
        else if (brandLower.includes('honda')) extracted.brand = "Honda";
        else if (brandLower.includes('toyota')) extracted.brand = "Toyota";
        else if (brandLower.includes('mahindra')) extracted.brand = "Mahindra";
        else if (brandLower.includes('kia')) extracted.brand = "Kia";
        else extracted.brand = null;
      }
      
      return extracted;
    }
    
    return { budget: null, type: null, brand: null };
  } catch (error) {
    console.error("Error extracting filters:", error.message);
    return { budget: null, type: null, brand: null };
  }
}

module.exports = { extractFilters };
