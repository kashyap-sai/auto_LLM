// === extractFilters.js ===
async function extractFilters(model, prompt) {
  const schema = {
    type: "object",
    properties: {
      budget: { type: "string" },
      type: { type: "string" },
      brand: { type: "string" }
    },
    required: []
  };

  const response = await model.generate({
    prompt: `Extract filters (budget, type, brand) from: "${prompt}". 
    - If user mentions price range, map it to budget.
    - If they mention car style (SUV, sedan, hatchback, etc.), map it to type.
    - If they mention a company (Hyundai, Tata, Maruti, Honda, etc.), map it to brand.
    - The message may contain spelling mistakes or typos. Normalize them and map to the closest valid brand, type, or budget value.
    Return only structured values.`,
    schema
  });

  return response;
}

module.exports = { extractFilters };
