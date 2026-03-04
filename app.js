let ingredients = []; // Local farm ingredients
let masterIngredients = []; // Global template database

// These are the most critical formulation constraints from the 200+ available INRA parameters.
// We explicitly define them so they always appear in the formulator's constraint limits UI.
let globalNutrients = [
    'dm', 'cp', 'cf', 'cfat', 'ash', 'ndf', 'adf', 'lignin', 'starch', 'sugars',
    'ca_gkg', 'p_gkg', 'phos_avail_gkg', 'na_gkg', 'cl_gkg', 'k_gkg', // Minerals
    'lys_gkg', 'met_gkg', 'cys_gkg', 'metcys_gkg', 'thr_gkg', 'trp_gkg', // Amino acids
    'men_poultry_kcalkg', 'amen_poultry_kcalkg', // Poultry Energy
    'de_growing_pig_kcalkg', 'me_growing_pig_kcalkg', 'ne_growing_pig_kcalkg', // Pig Energy
    'ufl_inra_2018_kcalkg', 'ufv_inra_2018_kcalkg' // Ruminant Energy
];

let activeCategory = 'All';

// Default basic ingredients just so new farms aren't totally empty
const defaultBaseIngredients = [
    { id: 'corn_base', name: 'Yellow Corn (Base)', category: 'Cereals', price: 0.25, dm: 88, me_poultry: 3350, cp: 8.5 },
    { id: 'sbm_base', name: 'Soybean Meal (Base)', category: 'Oilseeds', price: 0.45, dm: 89, me_poultry: 2230, cp: 48 }
];

async function loadFeedTablesData() {
    try {
        // Bypass CORS file:// restrictions by loading from JS variable directly
        const data = typeof INRA_DB !== 'undefined' ? INRA_DB : [];
        if (data.length === 0) throw new Error("INRA_DB completely empty. Ensure feedtables_data.js loaded.");

        // 1. We no longer force ALL 200 nutrients into the global UI schema to keep it clean.
        // We only append new keys if we really need them, but our core array is sufficient for the solver limits.
        const coreKeys = ['id', 'name', 'category', 'price'];

        let allPossibleInraNutrients = new Set(globalNutrients);
        data.forEach(item => {
            Object.keys(item).forEach(key => {
                if (!coreKeys.includes(key)) {
                    allPossibleInraNutrients.add(key.toLowerCase());
                }
            });
        });

        // Store this for the deep master database view
        window.allInraNutrients = Array.from(allPossibleInraNutrients);

        // 2. Load Master Database
        data.forEach(item => {
            let masterIng = {
                id: 'master_' + item.id,
                name: item.name,
                category: item.category || 'FeedTables Data', // You might extract the real INRA category later
                price: parseFloat(item.price) || 0.50, // Default dummy price
                isMaster: true
            };

            // Set all found nutrients onto the raw object
            window.allInraNutrients.forEach(nutrient => {
                masterIng[nutrient] = parseFloat(item[nutrient]) || 0;
            });

            // Fallbacks/Mappings if GE is present but ME is missing, etc.
            if (item.ge_kcal) {
                masterIng.me_poultry = masterIng.me_poultry || parseFloat(item.ge_kcal) || 0;
                masterIng.me_swine = masterIng.me_swine || parseFloat(item.ge_kcal) || 0;
            }

            masterIngredients.push(masterIng);
        });

        // 3. Render Master Database UI if we are on that page
        const masterListElement = document.getElementById('master-ingredients-list');
        if (masterListElement) {
            renderMasterDatabase();
            populateExportOrgs();
            return; // Exit here, don't run formulator specific code
        }

        // 4. Initialize Farm specific database
        const activeOrgStr = localStorage.getItem('novafeed_active_org');
        if (activeOrgStr) {
            const org = JSON.parse(activeOrgStr);
            const savedData = JSON.parse(localStorage.getItem('novafeed_data_' + org.id) || 'null');

            if (savedData && savedData.farmIngredients && savedData.farmIngredients.length > 0) {
                ingredients = savedData.farmIngredients; // Load farm saved
            } else {
                // Initialize new farm with defaults
                ingredients = JSON.parse(JSON.stringify(defaultBaseIngredients));
            }
        }

        renderCategories();
        renderIngredients();
        if (document.getElementById('requirements-list')) renderRequirements();
    } catch (e) {
        console.error("Data load failed:", e);

        // 5. Fallback if fetch fails (e.g. CORS on file:// protocol)
        const activeOrgStr = localStorage.getItem('novafeed_active_org');
        if (activeOrgStr) {
            const org = JSON.parse(activeOrgStr);
            const savedData = JSON.parse(localStorage.getItem('novafeed_data_' + org.id) || 'null');

            if (savedData && savedData.farmIngredients && savedData.farmIngredients.length > 0) {
                ingredients = savedData.farmIngredients; // Load farm saved
            } else {
                ingredients = JSON.parse(JSON.stringify(defaultBaseIngredients));
            }
        }

        // Only render farm ingredients if on formulator page
        if (document.getElementById('ingredients-list')) {
            renderCategories();
            renderIngredients();
            if (document.getElementById('requirements-list')) renderRequirements();
        }

        // Render master list fallback
        const masterListElement = document.getElementById('master-ingredients-list');
        if (masterListElement) {
            masterIngredients = JSON.parse(JSON.stringify(defaultBaseIngredients)); // Provide at least some data
            renderMasterDatabase();
        }
    }
}

// Requirements Templates
const requirements = {
    broiler_starter: {
        name: 'Broiler Starter (0-10 days)',
        nutrients: {
            me_poultry: { min: 3000, max: 3100 },
            cp: { min: 23.0 },
            calcium: { min: 1.0, max: 1.1 },
            phos_avail: { min: 0.45 },
            lysine: { min: 1.44 }
        }
    },
    layer_phase1: {
        name: 'Layer Phase 1 (Peak Production)',
        nutrients: {
            me_poultry: { min: 2750, max: 2850 },
            cp: { min: 17.5 },
            calcium: { min: 3.8, max: 4.2 },
            phos_avail: { min: 0.40 },
            lysine: { min: 0.90 }
        }
    }
};

// Formulation Engine functions
function formulateFeed(selectedIngredients, constraints) {
    if (!solver) {
        console.error("Solver not loaded");
        return null;
    }

    const model = {
        optimize: "cost",
        opType: "min",
        constraints: {},
        variables: {}
    };

    // Add total percentage constraint (must sum to 100%)
    model.constraints.total_weight = { equal: 100 };

    // Dynamic constraints based on requirements
    Object.keys(constraints).forEach(nutrient => {
        const value = constraints[nutrient];
        if (value.min !== undefined) {
            // We multiply by 100 because variable units are percentages (0-100)
            model.constraints[nutrient] = { min: value.min * 100 };
        }
        if (value.max !== undefined) {
            model.constraints[nutrient] = model.constraints[nutrient] || {};
            model.constraints[nutrient].max = value.max * 100;
        }
    });

    // Add variables (ingredients)
    selectedIngredients.forEach(ing => {
        const variable = {
            cost: ing.price,
            total_weight: 1
        };

        // Map ingredient attributes to constraints
        Object.keys(ing).forEach(key => {
            if (typeof ing[key] === 'number' && key !== 'price' && key !== 'min' && key !== 'max') {
                variable[key] = ing[key];
            }
        });

        // Add ingredient specific inclusion limits (e.g. max 20% wheat bran)
        if (ing.max !== undefined && ing.max !== '' && ing.max !== null) {
            model.constraints[ing.id + '_limit'] = { max: parseFloat(ing.max) };
            variable[ing.id + '_limit'] = 1;
        }
        if (ing.min !== undefined && ing.min !== '' && ing.min !== null) {
            model.constraints[ing.id + '_min_limit'] = { min: parseFloat(ing.min) };
            variable[ing.id + '_min_limit'] = 1;
        }

        model.variables[ing.id] = variable;
    });

    return solver.Solve(model);
}

// Global UI State
let currentFormula = null;
let ingredientChoices = ingredients.map(i => i.id);
let nutrientValues = {
    dm: { min: 88, max: null },
    me_poultry: { min: 3000, max: null },
    me_swine: { min: 3000, max: null },
    cp: { min: 21, max: null },
    cf: { min: null, max: 5 },
    cfat: { min: 2, max: null },
    ash: { min: null, max: 5 },
    ndf: { min: null, max: 10 },
    adf: { min: null, max: 5 },
    starch: { min: 40, max: null },
    sugars: { min: 5, max: null },
    lignin: { min: null, max: 2 },
    calcium: { min: 1.0, max: null },
    phos_avail: { min: 0.45, max: null },
    lysine: { min: 1.2, max: null }
};

// UI Rendering Functions
// --- Master Database Functions ---
function renderMasterDatabase() {
    const list = document.getElementById('master-ingredients-list');
    const filter = document.getElementById('master-category-filter');
    if (!list) return;

    // Categories
    const categories = ['All', ...new Set(masterIngredients.map(i => i.category || 'Uncategorized'))];
    if (filter) {
        filter.innerHTML = categories.map(cat => `
            <button onclick="setMasterCategory('${cat}')" class="btn ${activeCategory === cat ? 'btn-primary' : 'btn-outline'}" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; border-radius: 2rem; white-space: nowrap;">
                ${cat}
            </button>
        `).join('');
    }

    let displayedIngredients = activeCategory === 'All'
        ? masterIngredients
        : masterIngredients.filter(i => (i.category || 'Uncategorized') === activeCategory);

    // Apply search filter (new)
    const searchInput = document.getElementById('master-roster-search');
    if (searchInput && searchInput.value) {
        const query = searchInput.value.toLowerCase();
        displayedIngredients = displayedIngredients.filter(i => i.name.toLowerCase().includes(query) || i.category.toLowerCase().includes(query));
    }

    if (displayedIngredients.length === 0) {
        list.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.875rem;">No ingredients found matching filters.</div>';
        return;
    }

    list.innerHTML = displayedIngredients.map(ing => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-bottom: 1px solid var(--border-bright); background: var(--surface); cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='var(--surface-hover)'" onmouseout="this.style.background='var(--surface)'" onclick="openMasterDetail('${ing.id}')">
            <div>
                <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.25rem;">${ing.name}</div>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <span style="font-size: 0.75rem; color: var(--text-secondary); padding: 0.1rem 0.5rem; background: rgba(0,0,0,0.05); border-radius: 1rem;">${ing.category}</span>
                    <span style="font-size: 0.75rem; color: var(--primary); font-weight: 500;">CP: ${ing.cp || 0}%</span>
                    <span style="font-size: 0.75rem; color: var(--secondary); font-weight: 500;">DM: ${ing.dm || 0}%</span>
                </div>
            </div>
            <div style="text-align: right;">
                <div style="font-weight: 600; color: var(--text-primary);">$${ing.price.toFixed(2)}/kg</div>
                <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; justify-content: flex-end; gap: 0.25rem;">
                    Details <i data-lucide="chevron-right" style="width: 14px; height: 14px;"></i>
                </div>
            </div>
        </div>
    `).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function setMasterCategory(cat) {
    activeCategory = cat;
    renderMasterDatabase();
}

// Master DB Search Wrapper
function filterMasterDatabase() {
    renderMasterDatabase();
}

// --- Master Database Detail UI & Export Logic ---

let currentDetailMasterId = null;

function openMasterDetail(id) {
    const ing = masterIngredients.find(i => i.id === id);
    if (!ing) return;

    currentDetailMasterId = id;

    document.getElementById('detail-name').innerText = ing.name;
    document.getElementById('detail-category').innerText = ing.category;

    document.getElementById('master-detail-panel').style.display = 'flex';
    switchMasterTab('proximal'); // Default to general composition
}

function closeMasterDetail() {
    document.getElementById('master-detail-panel').style.display = 'none';
    currentDetailMasterId = null;
}

function switchMasterTab(tabName) {
    // UI Tab active state mapping
    document.querySelectorAll('.master-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.borderBottom = '2px solid transparent';
        btn.style.color = 'var(--text-secondary)';
    });

    const activeBtn = Array.from(document.querySelectorAll('.master-tab-btn')).find(el => el.getAttribute('onclick').includes(tabName));
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.borderBottom = '2px solid var(--primary)';
        activeBtn.style.color = 'var(--primary)';
    }

    renderDetailNutrients(tabName);
}

function renderDetailNutrients(tabName) {
    const container = document.getElementById('detail-nutrients-container');
    const ing = masterIngredients.find(i => i.id === currentDetailMasterId);
    if (!ing || !container) return;

    // Define dictionary structure mapping INRA fields to visual tabs
    const nutrientSets = {
        'proximal': ['dm', 'cp', 'cf', 'cfat', 'ash', 'ndf', 'adf', 'lignin', 'starch', 'sugars', 'wicw'],
        'amino': window.allInraNutrients.filter(n => n.includes('_gkg') && !['ca_gkg', 'p_gkg', 'phos_avail_gkg', 'na_gkg', 'cl_gkg', 'k_gkg', 'mg_gkg'].includes(n)),
        'minerals': ['ca_gkg', 'p_gkg', 'phos_avail_gkg', 'na_gkg', 'cl_gkg', 'k_gkg', 'mg_gkg', 'cu_mgkg', 'fe_mgkg', 'mn_mgkg', 'zn_mgkg'],
        'energy': window.allInraNutrients.filter(n => n.includes('kcal') || n.includes('uf') || n.includes('ed_'))
    };

    let keysToShow = nutrientSets[tabName] || [];

    // Filter to only show keys that actually exist for this ingredient to prevent extreme blank lists
    keysToShow = keysToShow.filter(k => ing[k] !== undefined && ing[k] !== null && ing[k] !== 0 && ing[k] !== "0");

    if (keysToShow.length === 0) {
        container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.875rem;">No data available for this category.</div>';
        return;
    }

    let html = '<div style="display: flex; flex-direction: column;">';
    keysToShow.forEach((k, index) => {
        const bg = index % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)';
        html += `
            <div style="display: flex; justify-content: space-between; padding: 0.75rem 1.5rem; background: ${bg}; border-bottom: 1px solid var(--border-bright);">
                <span style="font-size: 0.875rem; color: var(--text-primary); font-family: monospace;">${k.toUpperCase().replace('_', ' ')}</span>
                <span style="font-size: 0.875rem; font-weight: 600; color: var(--text-primary);">${ing[k]}</span>
            </div>
        `;
    });
    html += '</div>';

    container.innerHTML = html;
}

// Populate the Export Orgs Dropdown
function populateExportOrgs() {
    const select = document.getElementById('export-org-select');
    if (!select) return;

    const orgsStr = localStorage.getItem('novafeed_orgs');
    if (!orgsStr) {
        select.innerHTML = '<option value="">No Workspaces Found</option>';
        return;
    }

    const orgs = JSON.parse(orgsStr);
    select.innerHTML = orgs.map(org => `<option value="${org.id}">${org.name}</option>`).join('');
}

// Engine to push a Master Ingredient directly into an external Farm's local storage memory
function exportToFarm() {
    if (!currentDetailMasterId) return;

    const select = document.getElementById('export-org-select');
    if (!select || !select.value) {
        alert("Please select a valid workspace.");
        return;
    }

    const orgId = select.value;
    const masterIng = masterIngredients.find(i => i.id === currentDetailMasterId);
    if (!masterIng) return;

    // Load that org's specific data array
    const targetDataStr = localStorage.getItem('novafeed_data_' + orgId);
    let targetData = targetDataStr ? JSON.parse(targetDataStr) : { farmIngredients: [] };

    // Ensure array exists if schema changed recently
    if (!targetData.farmIngredients) targetData.farmIngredients = [];

    // Check if it already exists there
    if (targetData.farmIngredients.some(i => i.id === masterIng.id)) {
        alert("This ingredient has already been explicitly imported to that workspace.");
        return;
    }

    // Deep copy!
    const newFarmIng = JSON.parse(JSON.stringify(masterIng));
    targetData.farmIngredients.push(newFarmIng);
    targetData.lastUpdated = new Date().toISOString();

    // Write back to local storage silently!
    localStorage.setItem('novafeed_data_' + orgId, JSON.stringify(targetData));

    alert(`Successfully pushed ${masterIng.name} to the selected workspace!`);
}

// --- Farm Database Logic ---
function renderCategories() {
    const list = document.getElementById('category-filter');
    if (!list) return;

    // Get unique categories
    const categories = ['All', ...new Set(ingredients.map(i => i.category || 'Uncategorized'))];

    list.innerHTML = categories.map(cat => `
        <button onclick="setCategory('${cat}')" class="btn ${activeCategory === cat ? 'btn-primary' : 'btn-outline'}" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; border-radius: 2rem;">
            ${cat}
        </button>
    `).join('');
}

function setCategory(cat) {
    activeCategory = cat;
    renderCategories();
    renderIngredients();
}

function renderIngredients() {
    const list = document.getElementById('ingredients-list');
    if (!list) return;

    const displayedIngredients = activeCategory === 'All'
        ? ingredients
        : ingredients.filter(i => (i.category || 'Uncategorized') === activeCategory);

    list.innerHTML = displayedIngredients.map(ing => `
        <tr style="border-bottom: 1px solid var(--border-bright); background: ${ingredientChoices.includes(ing.id) ? 'rgba(16, 185, 129, 0.05)' : 'transparent'}; transition: background 0.2s;">
            <td style="text-align: center; padding: 0.5rem;">
                <input type="checkbox" id="check-${ing.id}" ${ingredientChoices.includes(ing.id) ? 'checked' : ''} onchange="toggleIngredient('${ing.id}')" style="accent-color: var(--primary);">
            </td>
            <td style="padding: 0.5rem; font-weight: 500; font-size: 0.85rem;">
                <label for="check-${ing.id}" style="cursor: pointer; display: block; width: 100%; margin: 0;">${ing.name}</label>
            </td>
            <td style="padding: 0.5rem;">
                <input type="number" step="0.01" value="${ing.price.toFixed(2)}" onchange="updateIngredientPrice('${ing.id}', this.value)" class="table-input" style="text-align: right; width: 100%; padding: 0.25rem;">
            </td>
            <td style="padding: 0.5rem;">
                <input type="number" step="1" min="0" max="100" id="min-${ing.id}" value="${ing.min !== undefined ? ing.min : ''}" placeholder="" onchange="updateIngredientLimit('${ing.id}', 'min', this.value)" class="table-input" style="text-align: right; width: 100%; padding: 0.25rem;">
            </td>
            <td style="padding: 0.5rem;">
                <input type="number" step="1" min="0" max="100" id="max-${ing.id}" value="${ing.max !== undefined ? ing.max : ''}" placeholder="" onchange="updateIngredientLimit('${ing.id}', 'max', this.value)" class="table-input" style="text-align: right; width: 100%; padding: 0.25rem;">
            </td>
            <td style="padding: 0.5rem; text-align: right; font-weight: 600; color: var(--primary); font-size: 0.85rem;" id="res-usage-${ing.id}">
                -
            </td>
            <td style="padding: 0.5rem; text-align: right; font-weight: 600; color: var(--secondary); font-size: 0.85rem;" id="res-batch-${ing.id}">
                -
            </td>
            <td style="padding: 0.5rem; text-align: right; font-weight: 600; color: var(--text-primary); font-size: 0.85rem;" id="res-cost-${ing.id}">
                -
            </td>
            <td style="padding: 0.5rem; text-align: center;">
                <button type="button" class="btn btn-outline" style="padding: 0.2rem 0.4rem; font-size: 0.7rem; border: none; background: transparent;" onclick="openEditIngredientForm('${ing.id}')">
                    <i data-lucide="edit-2" style="width: 14px; height: 14px; color: var(--text-secondary);"></i>
                </button>
            </td>
        </tr>
    `).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}


function renderRequirements() {
    const list = document.getElementById('requirements-list');
    const nutrients = [
        { id: 'dm', name: 'Dry Matter (%)', step: 0.5 },
        { id: 'me_poultry', name: 'Poultry Energy (kcal/kg)', step: 50 },
        { id: 'me_swine', name: 'Swine Energy (kcal/kg)', step: 50 },
        { id: 'cp', name: 'Crude Protein (%)', step: 0.5 },
        { id: 'cf', name: 'Crude Fiber (%)', step: 0.5 },
        { id: 'cfat', name: 'Crude Fat (%)', step: 0.5 },
        { id: 'ash', name: 'Ash (%)', step: 0.5 },
        { id: 'ndf', name: 'NDF (%)', step: 0.5 },
        { id: 'adf', name: 'ADF (%)', step: 0.5 },
        { id: 'starch', name: 'Starch (%)', step: 0.5 },
        { id: 'sugars', name: 'Sugars (%)', step: 0.5 },
        { id: 'lignin', name: 'Lignin (%)', step: 0.5 },
        { id: 'calcium', name: 'Calcium (%)', step: 0.1 },
        { id: 'phos_avail', name: 'Available Phos. (%)', step: 0.05 },
        { id: 'lysine', name: 'Lysine (%)', step: 0.05 }
    ];

    list.innerHTML = nutrients.map(n => `
        <div style="display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.5rem; background: var(--surface-hover); padding: 0.75rem; border-radius: 0.5rem;">
            <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">${n.name}</label>
            <div style="display: flex; gap: 1rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1;">
                    <span style="font-size: 0.75rem; color: var(--text-secondary);">Min:</span>
                    <input type="number" id="min-${n.id}" value="${nutrientValues[n.id]?.min !== null ? nutrientValues[n.id].min : ''}" step="${n.step}" onchange="updateNutrientRange('${n.id}', 'min', this.value)" placeholder="No Min" style="width: 100%; text-align: right; background: var(--background); color: var(--text-primary); border: 1px solid var(--border-bright); padding: 0.35rem 0.5rem; border-radius: 0.25rem; outline: none; transition: border-color 0.2s;" onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor='var(--border-bright)'">
                </div>
                <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1;">
                    <span style="font-size: 0.75rem; color: var(--text-secondary);">Max:</span>
                    <input type="number" id="max-${n.id}" value="${nutrientValues[n.id]?.max !== null ? nutrientValues[n.id].max : ''}" step="${n.step}" onchange="updateNutrientRange('${n.id}', 'max', this.value)" placeholder="No Max" style="width: 100%; text-align: right; background: var(--background); color: var(--text-primary); border: 1px solid var(--border-bright); padding: 0.35rem 0.5rem; border-radius: 0.25rem; outline: none; transition: border-color 0.2s;" onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor='var(--border-bright)'">
                </div>
            </div>
        </div>
    `).join('');
}

function updateRequirementsUI() {
    Object.keys(nutrientValues).forEach(id => {
        const minInput = document.getElementById(`min-${id}`);
        const maxInput = document.getElementById(`max-${id}`);
        if (minInput) minInput.value = nutrientValues[id].min !== null ? nutrientValues[id].min : '';
        if (maxInput) maxInput.value = nutrientValues[id].max !== null ? nutrientValues[id].max : '';
    });
}


// State Management
function toggleIngredient(id) {
    if (ingredientChoices.includes(id)) {
        ingredientChoices = ingredientChoices.filter(i => i !== id);
    } else {
        ingredientChoices.push(id);
    }
    renderIngredients();
}

function toggleAllIngredients(checked) {
    if (checked) {
        const displayedIngredients = activeCategory === 'All'
            ? ingredients
            : ingredients.filter(i => (i.category || 'Uncategorized') === activeCategory);
        ingredientChoices = displayedIngredients.map(i => i.id);
    } else {
        ingredientChoices = [];
    }
    renderIngredients();
}

function updateIngredientPrice(id, newPrice) {
    const ing = ingredients.find(i => i.id === id);
    if (ing) {
        ing.price = parseFloat(newPrice) || 0;
    }
}

function updateIngredientLimit(id, type, value) {
    const ing = ingredients.find(i => i.id === id);
    if (!ing) return;

    if (value === '') {
        delete ing[type];
    } else {
        ing[type] = parseFloat(value);
    }
}

let currentEditId = null;

function generateNutrientInputs(ing = null) {
    const container = document.getElementById('dynamic-nutrient-inputs');
    // First, preserve the name and price elements so we don't delete them
    const nameStr = `
        <div style="grid-column: span 3; display: flex; flex-direction: column; gap: 0.35rem;">
            <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">Ingredient Name</label>
            <input type="text" id="new-ing-name" placeholder="E.g., Yellow Corn" value="${ing ? ing.name : ''}"
                style="width: 100%; padding: 0.5rem 0.75rem; background: var(--background); color: var(--text-primary); border: 1px solid var(--border-bright); border-radius: 0.5rem; box-sizing: border-box; outline: none; transition: all 0.2s;"
                onfocus="this.style.borderColor='var(--primary)';"
                onblur="this.style.borderColor='var(--border-bright)';">
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.35rem;">
            <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">Price ($/kg)</label>
            <input type="number" step="0.01" id="new-ing-price" placeholder="0.00" value="${ing ? ing.price : ''}"
                style="width: 100%; padding: 0.5rem 0.75rem; background: var(--background); color: var(--text-primary); border: 1px solid var(--border-bright); border-radius: 0.5rem; box-sizing: border-box; outline: none; transition: all 0.2s;"
                onfocus="this.style.borderColor='var(--primary)';"
                onblur="this.style.borderColor='var(--border-bright)';">
        </div>
    `;

    // Filter out 'me_swine' and similar if you want, or just loop all globalNutrients
    const inputsHTML = globalNutrients.map(n => {
        // Format label: Replace underscores with space, uppercase first letter
        const label = n.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const val = ing ? (ing[n] || 0) : '';
        return `
            <div style="display: flex; flex-direction: column; gap: 0.35rem;">
                <label title="${label}" style="font-size: 0.85rem; color: var(--text-secondary); text-overflow: ellipsis; white-space: nowrap; overflow: hidden; cursor: help;">${label}</label>
                <input type="number" step="any" id="new-ing-${n}" placeholder="0" value="${val}"
                    style="width: 100%; padding: 0.5rem 0.75rem; background: var(--background); color: var(--text-primary); border: 1px solid var(--border-bright); border-radius: 0.5rem; box-sizing: border-box; outline: none; transition: all 0.2s;"
                    onfocus="this.style.borderColor='var(--primary)';"
                    onblur="this.style.borderColor='var(--border-bright)';">
            </div>
        `;
    }).join('');

    container.innerHTML = nameStr + inputsHTML;
}

function openAddIngredientForm() {
    currentEditId = null;
    document.getElementById('ingredient-form-title').innerText = 'New Custom Ingredient';
    generateNutrientInputs(); // Will render empty formulation
    document.getElementById('add-ingredient-form').style.display = 'block';
}

function openEditIngredientForm(id) {
    currentEditId = id;
    const ing = ingredients.find(i => i.id === id);
    if (!ing) return;
    document.getElementById('ingredient-form-title').innerText = 'Edit Ingredient';
    generateNutrientInputs(ing); // Will populate with exact ingredient variables
    document.getElementById('add-ingredient-form').style.display = 'block';
}

function saveIngredient() {
    const nameInput = document.getElementById('new-ing-name');
    if (!nameInput || !nameInput.value) {
        alert("Please enter a name for the ingredient.");
        return;
    }
    const name = nameInput.value;
    const price = parseFloat(document.getElementById('new-ing-price').value) || 0;

    let targetIng;
    if (currentEditId) {
        targetIng = ingredients.find(i => i.id === currentEditId);
        if (targetIng) {
            targetIng.name = name;
            targetIng.price = price;
        }
    } else {
        const id = 'custom_' + Date.now();
        targetIng = { id: id, name: name, category: 'Custom', price: price };
        ingredients.push(targetIng);
        ingredientChoices.push(id); // auto-select
    }

    // Capture dynamic nutrients
    globalNutrients.forEach(n => {
        const el = document.getElementById(`new-ing-${n}`);
        if (el) targetIng[n] = parseFloat(el.value) || 0;
    });

    renderIngredients();
    renderCategories();
    document.getElementById('add-ingredient-form').style.display = 'none';

    saveOrgData(); // Save to local storage
}

function saveOrgData() {
    const activeOrgStr = localStorage.getItem('novafeed_active_org');
    if (!activeOrgStr) return;
    const org = JSON.parse(activeOrgStr);

    // Save ALL farm ingredients now (both custom and imported master copies)
    const dataToSave = {
        farmIngredients: ingredients,
        lastUpdated: new Date().toISOString()
    };

    localStorage.setItem('novafeed_data_' + org.id, JSON.stringify(dataToSave));
}

// --- Import from Master Logic ---
function openImportMasterModal() {
    document.getElementById('import-master-modal').style.display = 'block';
    renderMasterImportList();
}

function closeImportMasterModal() {
    document.getElementById('import-master-modal').style.display = 'none';
}

function renderMasterImportList() {
    const list = document.getElementById('master-import-list');
    const searchInput = document.getElementById('master-search-input');
    if (!list) return;

    // Filter out ingredients already in the farm
    let availableMasters = masterIngredients.filter(m => !ingredients.some(i => i.id === m.id));

    // Apply search filter if present
    if (searchInput && searchInput.value) {
        const query = searchInput.value.toLowerCase();
        availableMasters = availableMasters.filter(m => m.name.toLowerCase().includes(query) || m.category.toLowerCase().includes(query));
    }

    if (availableMasters.length === 0) {
        list.innerHTML = '<p style="text-align:center; padding: 2rem; color: var(--text-muted);">No matching Master ingredients found!</p>';
        return;
    }

    list.innerHTML = availableMasters.map(ing => `
        <label style="display: flex; align-items: center; gap: 1rem; padding: 0.75rem; border-bottom: 1px solid var(--border-bright); cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='var(--surface-hover)'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" class="master-import-checkbox" value="${ing.id}" style="width: 1.25rem; height: 1.25rem; accent-color: var(--primary); cursor: pointer;">
            <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 0.875rem; color: var(--text-primary);">${ing.name}</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">${ing.category}</div>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; gap: 0.5rem;">
                <span title="Crude Protein">CP: ${ing.cp || 0}%</span>
                <span title="Dry Matter">DM: ${ing.dm || 0}%</span>
            </div>
        </label>
    `).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function importSelectedMasters() {
    const checkboxes = document.querySelectorAll('.master-import-checkbox:checked');
    if (checkboxes.length === 0) {
        alert("Please select at least one ingredient to import.");
        return;
    }

    let importedCount = 0;

    checkboxes.forEach(cb => {
        const masterId = cb.value;
        const masterIng = masterIngredients.find(i => i.id === masterId);
        if (masterIng) {
            // Deep copy so edits don't affect master
            const newFarmIng = JSON.parse(JSON.stringify(masterIng));
            ingredients.push(newFarmIng);
            ingredientChoices.push(newFarmIng.id); // Auto select it
            importedCount++;
        }
    });

    if (importedCount > 0) {
        saveOrgData();
        renderIngredients();
        renderCategories();
        closeImportMasterModal();

        // Brief toast notification (optional, using alert for now)
        // alert(`Successfully imported ${importedCount} ingredients to this farm.`);
    }
}


function updateNutrientRange(id, type, val) {
    if (!nutrientValues[id]) nutrientValues[id] = { min: null, max: null };

    if (val === '') {
        nutrientValues[id][type] = null;
    } else {
        nutrientValues[id][type] = parseFloat(val);
    }
}

function handleFormulate() {
    const activeIngredients = ingredients.filter(i => ingredientChoices.includes(i.id));

    // Create constraints object expected by solver
    const constraints = {};
    Object.keys(nutrientValues).forEach(key => {
        const obj = nutrientValues[key];
        if (obj && (obj.min !== null || obj.max !== null)) {
            constraints[key] = {};
            if (obj.min !== null) constraints[key].min = obj.min;
            if (obj.max !== null) constraints[key].max = obj.max;
        }
    });

    const result = formulateFeed(activeIngredients, constraints);
    displayResults(result, activeIngredients);
}

function displayResults(result, activeIngredients) {
    const resultsDiv = document.getElementById('results');
    const formulaList = document.getElementById('formula-result');

    resultsDiv.style.display = 'block';
    resultsDiv.scrollIntoView({ behavior: 'smooth' });

    // Reset Table columns
    ingredients.forEach(ing => {
        const usageEl = document.getElementById(`res-usage-${ing.id}`);
        const batchEl = document.getElementById(`res-batch-${ing.id}`);
        const costEl = document.getElementById(`res-cost-${ing.id}`);
        if(usageEl) usageEl.innerText = '-';
        if(batchEl) batchEl.innerText = '-';
        if(costEl) costEl.innerText = '-';
    });

    if (!result.feasible) {
        formulaList.innerHTML = `<p style="color: #ef4444; font-weight: 600;">Infeasible Solution. Please adjust requirements or select more ingredients.</p>`;
        return;
    }

    const batchInput = document.getElementById('batch-size-input');
    const totalBatchSize = batchInput ? (parseFloat(batchInput.value) || 1000) : 1000;

    let html = '<div style="margin-bottom: 1.5rem;">';
    let rejectedHtml = '<div style="margin-top: 1.5rem; border-top: 1px solid var(--border); padding-top: 1.5rem;"><h4 style="font-size: 1rem; font-weight: 600; margin-bottom: 1rem; color: var(--text-secondary);">Rejected Ingredients</h4>';
    let hasRejected = false;
    let totalComputedCost = 0;

    activeIngredients.forEach(ingredient => {
        const val = result[ingredient.id] || 0;
        if (val > 0) {
            const usagePercent = val;
            const batchKg = (usagePercent / 100) * totalBatchSize;
            const cost = batchKg * ingredient.price;
            totalComputedCost += cost;

            // Update Table
            const usageEl = document.getElementById(`res-usage-${ingredient.id}`);
            const batchEl = document.getElementById(`res-batch-${ingredient.id}`);
            const costEl = document.getElementById(`res-cost-${ingredient.id}`);
            if(usageEl) usageEl.innerText = usagePercent.toFixed(2);
            if(batchEl) batchEl.innerText = batchKg.toFixed(2);
            if(costEl) costEl.innerText = cost.toFixed(2);

            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid var(--border);">
                    <span style="font-weight: 500;">${ingredient.name}</span>
                    <span style="font-weight: 700; color: var(--primary);">${usagePercent.toFixed(2)}%</span>
                </div>
            `;
        } else {
            // Check if there is a 0 usage update needed on table
            const usageEl = document.getElementById(`res-usage-${ingredient.id}`);
            if(usageEl) usageEl.innerText = "0.00";

            hasRejected = true;
            rejectedHtml += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; background: var(--surface-hover); border-radius: 0.5rem; margin-bottom: 0.5rem;">
                    <span style="color: var(--text-muted); text-decoration: line-through;">${ingredient.name}</span>
                    <span style="font-size: 0.8rem; color: var(--text-secondary);">$${ingredient.price.toFixed(2)}/kg</span>
                </div>
            `;
        }
    });

    html += '</div>';
    if (hasRejected) {
        rejectedHtml += '</div>';
        html += rejectedHtml;
    }

    html += `
        <div style="margin-top: 1rem; padding: 1rem; background: rgba(16, 185, 129, 0.1); border-radius: 0.5rem; display: flex; justify-content: space-between;">
            <span style="font-weight: 600;">Optimal Cost (Batch)</span>
            <span style="font-weight: 700; color: var(--secondary);">$${totalComputedCost.toFixed(2)} / ${totalBatchSize}kg</span>
        </div>
    `;

    formulaList.innerHTML = html;
    updateChart(result, activeIngredients);
}

let myChart = null;
function updateChart(result, activeIngredients) {
    const ctx = document.getElementById('nutrient-chart').getContext('2d');

    // Calculate actual nutrient levels in the result
    const actuals = {};
    const ALL_NUTRIENTS = ['dm', 'me_poultry', 'cp', 'cf', 'cfat', 'ash', 'ndf', 'adf', 'starch', 'sugars', 'lignin', 'calcium', 'phos_avail', 'lysine'];
    ALL_NUTRIENTS.forEach(n => actuals[n] = 0);

    Object.keys(result).forEach(key => {
        const ingredient = activeIngredients.find(i => i.id === key);
        if (ingredient) {
            ALL_NUTRIENTS.forEach(n => {
                actuals[n] += (ingredient[n] || 0) * (result[key] / 100);
            });
        }
    });

    const labels = ['Dry Matter', 'Energy', 'Protein', 'Fiber', 'Fat', 'Ash', 'NDF', 'ADF', 'Starch', 'Sugars', 'Lignin', 'Calcium', 'Phos', 'Lysine'];
    const dataActual = [actuals['dm'], actuals['me_poultry'], actuals['cp'], actuals['cf'], actuals['cfat'], actuals['ash'], actuals['ndf'], actuals['adf'], actuals['starch'], actuals['sugars'], actuals['lignin'], actuals['calcium'], actuals['phos_avail'], actuals['lysine']];
    const dataTarget = [
        nutrientValues['dm']?.min || 0,
        nutrientValues['me_poultry']?.min || 0,
        nutrientValues['cp']?.min || 0,
        nutrientValues['cf']?.max || 0,
        nutrientValues['cfat']?.min || 0,
        nutrientValues['ash']?.max || 0,
        nutrientValues['ndf']?.max || 0,
        nutrientValues['adf']?.max || 0,
        nutrientValues['starch']?.min || 0,
        nutrientValues['sugars']?.min || 0,
        nutrientValues['lignin']?.max || 0,
        nutrientValues['calcium']?.min || 0,
        nutrientValues['phos_avail']?.min || 0,
        nutrientValues['lysine']?.min || 0
    ];

    if (myChart) myChart.destroy();

    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Result',
                    data: dataActual,
                    backgroundColor: 'rgba(37, 99, 235, 0.8)',
                    borderRadius: 4
                },
                {
                    label: 'Requirement',
                    data: dataTarget,
                    backgroundColor: 'rgba(16, 185, 129, 0.3)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 1,
                    type: 'line'
                }
            ]
        },
        options: {
            responsive: true,
            scales: {
                y: { display: false } // Auto scale, hide axis for cleaner look
            },
            plugins: {
                legend: { labels: { color: '#94a3b8' } }
            }
        }
    });
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    console.log("NovaFeed Initialized");

    // Check if we are on the formulator page by testing for a core element
    const categoryFilter = document.getElementById('category-filter');
    const masterFilter = document.getElementById('master-category-filter');

    // Load external data (this dictates if we populate Master array or Farm array based on page)
    loadFeedTablesData();

    if (categoryFilter) {
        // UI rendering relies on loadFeedTablesData resolving first because of data sync, but 
        // JS is async. In a real app we would wait for the promise. Since this is a prototype,
        // loadFeedTablesData internally calls renderIngredients() when finished.

        const formulateBtn = document.getElementById('formulate-btn');
        if (formulateBtn) formulateBtn.addEventListener('click', handleFormulate);

        const templateSelect = document.getElementById('template-select');
        if (templateSelect) {
            templateSelect.addEventListener('change', (e) => {
                const template = requirements[e.target.value];
                if (template) {
                    Object.keys(template.nutrients).forEach(n => {
                        nutrientValues[n] = {
                            min: template.nutrients[n].min !== undefined ? template.nutrients[n].min : null,
                            max: template.nutrients[n].max !== undefined ? template.nutrients[n].max : null
                        };
                    });
                    updateRequirementsUI();
                }
            });
        }
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
});
