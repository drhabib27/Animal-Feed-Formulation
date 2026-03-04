const fs = require('fs');

try {
    const rawData = fs.readFileSync('feedtables_all_data.json', 'utf8');
    const data = JSON.parse(rawData);

    let globalNutrients = ['dm', 'me_poultry', 'cp', 'cf', 'cfat', 'ash', 'ndf', 'adf', 'starch', 'sugars', 'lignin', 'calcium', 'phos_avail', 'lysine'];
    let originalLength = globalNutrients.length;

    const coreKeys = ['id', 'name', 'category', 'price', 'nutrients'];
    data.forEach(item => {
        const dataSource = item.nutrients || item;
        Object.keys(dataSource).forEach(key => {
            if (!coreKeys.includes(key) && !globalNutrients.includes(key)) {
                globalNutrients.push(key);
            }
        });
    });

    console.log("Original Nutrients Length:", originalLength);
    console.log("Found Total Nutrients:", globalNutrients.length);
    console.log(globalNutrients);
} catch (e) {
    console.error("Error reading file:", e);
}
