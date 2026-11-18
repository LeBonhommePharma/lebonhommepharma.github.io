/* Drug of the Day — the one picker for the whole site.
   ==========================================================================

   Every surface that names "today's drug" reads it from here and nowhere else:
     /                      home: ℞ nav link, the product card, the footer tile
     /drug-of-the-day/      the short link: redirects to today's page (?all = archive)
     /flexaid-ds/           hero badge + Mol* hero structure
     /FlexAIDdS/            hero badge + Mol* hero structure
   Before this file there were four pickers that disagreed with each other: the home
   page took the visitor's LOCAL day-of-year mod 63 (so Tokyo and Montréal saw different
   drugs, and the cycle restarted every 1 January); the two FlexAIDΔS pages took UTC days
   mod 8; root app.js took UTC days mod 70. Do not add a fifth. scripts/check-dotd.mjs
   fails CI if any page grows its own list or its own day arithmetic.

   THE RULE
     day   = the calendar date in Montréal (America/Toronto), whatever the visitor's clock
             zone is. Everyone on Earth has the same drug at the same instant, and it
             changes at midnight Montréal time (00:00 EST / 00:00 EDT — DST handled by
             the platform's time-zone database, not by arithmetic on offsets).
     index = whole days since EPOCH, modulo ROTATION.length. Continuous: no reset on
             1 January, so the list order IS the calendar, forever.
     EPOCH = 2026-09-09 → row 0, Cocaine HCl. That is the old home page's day 252 → row 0,
             so every date from the epoch to 2026-12-31 maps exactly as it did before.

   ROWS — "name|slug|series|pdb|target|type|class|note"
     name, type, class, note: the home page's live list, character for character, in its
       live order (63 entries). Curation notes on type and class below, moved here with
       the list.
     slug:   the page under /drug-of-the-day/. Dextromethorphan uses the canonical
             queue.json slug, dxm (#041); /dextromethorphan/ is an unlisted duplicate.
     series, pdb: from drug-of-the-day/queue.json, the canonical series. CI checks them.
     target: the receptor label the FlexAIDΔS hero badge shows beside the PDB code.

   `type` is the compound's PokeDrugType (LeBonhommePharma/NATURaL, BonhommeCore/Analysis/
   PokeDrugType.swift): twelve target classes — serotonin · opioid · dopamine · empathogen ·
   dissociative · cannabinoid · kappa · stimulant · sedative · cholinergic · adenosine ·
   sigma — in NATURaL's exact case spelling. Where PokeDrugSpecies.swift catalogues the
   compound, its primaryType is taken as-is (22 of the 63; secondary types stay in the note).
   A trailing "?" marks a forced fit — the target is the type's, but the action or the name
   misdescribes the drug — and "-" means no type is honest. Coverage on 2026-09-10: 37 clean,
   3 catalogued but stretched (CBD is no CB1/CB2 agonist, GHB is GABA-B not GABA-A, ibogaine
   is multi-target and NATURaL calls it opioid first), 6 forced, 17 with no honest home: the
   five SERT/NET reuptake inhibitors, the six D2 antagonists, the four channel and α2δ
   ligands, lithium, melatonin. LP ruled PokeDrugType; twelve target classes cannot label 63
   compounds alone without a catch-all, and a catch-all is the failure above.

   `class` is what renders — the finest NATURaL target-class label that is honest:
     1. the PokeDrugType, display-cased, for the 40 it fits (Empathogen's prototype drug IS
        MDMA; Kappa's IS Salvinorin A);
     2. the PokeDrugSuperaCluster (PokeDrugSuperaCluster.swift, five systems) where the type
        is not honest but the system is: the five SSRI/SNRIs and buspirone are Serotonergic;
     3. the previous label for the 17 neither vocabulary can carry without lying. Opioid
        antagonist for naloxone and naltrexone — PokeDrugType has only .opioid, defined as
        μ agonism, and the same chip as fentanyl is the exact failure above (NATURaL's own
        PK profile files naltrexone under opioidAnalgesic). Anti-dementia agent (ATC N06D)
        for memantine and donepezil. Antipsychotic, Anticonvulsant and Antihistamine from
        TherapeuticClass (PharmacokineticProfile.swift). Mood stabilizer for lithium, which
        NATURaL's PK profile files under anticonvulsant and which is not one. Melatonin
        receptor agonist (ATC N05CH).
   What the twelve cases cannot say stays in the note: partial vs full agonist
   (buprenorphine, mitragynine, varenicline), prodrug (codeine, lisdexamfetamine,
   psilocybin), secondary types (LSD's dopamine, DMT's and dextromethorphan's sigma, MDMA's
   stimulant, ibogaine's dissociative); and Dopamine on modafinil and bupropion is the type's
   own letter — "DAT inhibition" — not a claim of kinship with cocaine.
   Classes carry no Greek: .hp-tag and .hp-flink-r are CSS-uppercased, which would render a
   lowercase μ as Μ, and NATURaL spells the case "kappa", not κ. Mechanism detail — including
   μ/κ — stays in the note, which is not.
*/
(function (root) {
  'use strict';

  var ZONE = 'America/Toronto';
  var EPOCH = '2026-09-09';
  var DAY_MS = 86400000;

  var ROWS = [
    "Cocaine HCl|cocaine|001|4xp4|dopamine transporter (DAT)|dopamine|Dopamine|competitive DAT/NET/SERT reuptake inhibitor · DAT Ki ≈ 250 nM",
    "MDMA|mdma|002|6dzv|serotonin transporter (SERT)|empathogen|Empathogen|substrate-mediated SERT/NET/DAT efflux · SERT Ki = 34 nM · FDA Breakthrough Therapy",
    "DMT|dmt|003|6wha|5-HT₂A receptor|serotonin|Serotonin|endogenous 5-HT2A agonist · Ki ≈ 170 nM · near-zero tolerance",
    "Psilocin|psilocin|004|7wc7|5-HT₂A receptor|serotonin|Serotonin|psilocybin’s active metabolite · 5-HT2A Ki ~107 nM",
    "LSD|lsd|005|6wgt|5-HT₂B receptor|serotonin|Serotonin|ergoline · 5-HT2A Ki ~1 nM · receptor lid-lock",
    "Amphetamine|amphetamine|006|7xna|dopamine transporter (DAT)|dopamine|Dopamine|DAT/NET substrate-releaser · DAT Ki ~1,400 nM",
    "Fentanyl|fentanyl|007|8ef5|μ-opioid receptor|opioid|Opioid|μ-opioid full agonist · MOR Ki ~1.1 nM · naloxone-reversible",
    "Salvinorin A|salvinorin-a|008|4djh|κ-opioid receptor|kappa|Kappa|κ-opioid full agonist · KOR Ki ~1.8 nM · non-serotonergic",
    "Ketamine|ketamine|011|7eu7|NMDA receptor|dissociative|Dissociative|NMDA-receptor antagonist · dissociative anesthetic · esketamine FDA-approved for depression",
    "Methamphetamine|methamphetamine|010|4xp6|dopamine transporter (DAT)|dopamine|Dopamine|TAAR1 agonist & monoamine releaser · Schedule II (Desoxyn)",
    "Methylphenidate|methylphenidate|023|4xp4|dopamine transporter (DAT)|dopamine|Dopamine|DAT/NET reuptake inhibitor · ADHD (Ritalin)",
    "Lisdexamfetamine|lisdexamfetamine|072|7xna|dopamine transporter (DAT)|dopamine|Dopamine|amphetamine prodrug · ADHD (Vyvanse)",
    "Modafinil|modafinil|073|4xp4|dopamine transporter (DAT)|dopamine|Dopamine|atypical DAT inhibitor · wakefulness-promoting (Provigil)",
    "Morphine|morphine|009|5c1m|μ-opioid receptor|opioid|Opioid|μ-opioid full agonist · prototypical analgesic",
    "Oxycodone|oxycodone|018|5c1m|μ-opioid receptor|opioid|Opioid|semi-synthetic μ-opioid full agonist",
    "Hydromorphone|hydromorphone|074|5c1m|μ-opioid receptor|opioid|Opioid|μ-opioid full agonist · potent analgesic",
    "Codeine|codeine|075|5c1m|μ-opioid receptor|opioid|Opioid|μ-opioid prodrug · CYP2D6 → morphine",
    "Tramadol|tramadol|021|5c1m|μ-opioid receptor|opioid|Opioid|μ-opioid agonist + serotonin/NE reuptake inhibitor",
    "Methadone|methadone|019|5c1m|μ-opioid receptor|opioid|Opioid|μ-opioid agonist + NMDA antagonist · OUD maintenance",
    "Buprenorphine|buprenorphine|020|5c1m|μ-opioid receptor|opioid|Opioid|partial μ-opioid agonist / κ antagonist · OUD (Suboxone)",
    "Naloxone|naloxone|076|4dkl|μ-opioid receptor|opioid?|Opioid antagonist|competitive μ-opioid antagonist · overdose reversal (Narcan)",
    "Naltrexone|naltrexone|070|4dkl|μ-opioid receptor|opioid?|Opioid antagonist|opioid antagonist · alcohol & opioid use disorder",
    "Diazepam|diazepam|015|6hup|GABAₐ receptor (BZD site)|sedative|Sedative|GABA-A positive allosteric modulator · benzodiazepine (Valium)",
    "Alprazolam|alprazolam|033|6huo|GABAₐ receptor (BZD site)|sedative|Sedative|GABA-A PAM · benzodiazepine (Xanax)",
    "Clonazepam|clonazepam|034|6hup|GABAₐ receptor (BZD site)|sedative|Sedative|GABA-A PAM · benzodiazepine (Klonopin)",
    "Zolpidem|zolpidem|035|8dd2|GABAₐ receptor (α₁)|sedative|Sedative|GABA-A α1-selective PAM · Z-drug hypnotic (Ambien)",
    "Propofol|propofol|077|6x3t|GABAₐ receptor (TMD sites)|sedative|Sedative|GABA-A PAM · IV general anesthetic",
    "Nitrous Oxide|nitrous-oxide|042|4pe5|NMDA receptor|dissociative|Dissociative|NMDA antagonist · inhaled anesthetic & analgesic",
    "Dextromethorphan|dxm|041|7eu7|NMDA receptor|dissociative|Dissociative|NMDA antagonist / σ1 agonist · dissociative at high dose",
    "Memantine|memantine|043|7sad|NMDA receptor|dissociative?|Anti-dementia agent|uncompetitive NMDA antagonist · Alzheimer’s",
    "Caffeine|caffeine|014|5mzp|adenosine A₂A receptor|adenosine|Adenosine|adenosine A1/A2A receptor antagonist",
    "Nicotine|nicotine|013|5kxi|α₄β₂ nicotinic receptor|cholinergic|Cholinergic|nicotinic acetylcholine-receptor agonist",
    "Varenicline|varenicline|068|6ur8|α₄β₂ nicotinic receptor|cholinergic|Cholinergic|α4β2 nicotinic partial agonist · smoking cessation (Chantix)",
    "THC|thc|012|5xra|CB₁ receptor|cannabinoid|Cannabinoid|CB1/CB2 partial agonist · principal cannabinoid",
    "CBD|cbd|060|5u09|CB₁ receptor|cannabinoid|Cannabinoid|non-euphoric cannabinoid · 5-HT1A / TRPV1 · FDA (Epidiolex)",
    "Psilocybin|psilocybin|029|7wc5|5-HT₂A receptor|serotonin|Serotonin|prodrug → psilocin · 5-HT2A agonist · Breakthrough Therapy",
    "Mescaline|mescaline|016|7ran|5-HT₂A receptor|serotonin|Serotonin|phenethylamine 5-HT2A agonist",
    "2C-B|2c-b|026|7ran|5-HT₂A receptor|serotonin|Serotonin|phenethylamine 5-HT2A agonist / partial",
    "Ibogaine|ibogaine|031|6dzv|serotonin transporter (SERT)|opioid|Opioid|multi-target (NMDA, opioid, σ) · anti-addictive",
    "Fluoxetine|fluoxetine|044|4mm8|serotonin transporter (SERT)|-|Serotonergic|SSRI · serotonin reuptake inhibitor (Prozac)",
    "Sertraline|sertraline|045|6awo|serotonin transporter (SERT)|-|Serotonergic|SSRI (Zoloft)",
    "Escitalopram|escitalopram|046|5i73|serotonin transporter (SERT)|-|Serotonergic|SSRI (Lexapro)",
    "Venlafaxine|venlafaxine|048|5i6x|serotonin transporter (SERT)|-|Serotonergic|SNRI · serotonin-norepinephrine reuptake inhibitor",
    "Duloxetine|duloxetine|078|5i6x|SERT / NET|-|Serotonergic|SNRI (Cymbalta)",
    "Bupropion|bupropion|049|4m48|dopamine transporter (DAT)|dopamine|Dopamine|NDRI · norepinephrine-dopamine reuptake inhibitor (Wellbutrin)",
    "Buspirone|buspirone|069|7e2y|5-HT₁A receptor|serotonin?|Serotonergic|5-HT1A partial agonist · anxiolytic",
    "Aripiprazole|aripiprazole|056|7e2z|dopamine D₂ receptor|-|Antipsychotic|dopamine D2 partial agonist · atypical antipsychotic (Abilify)",
    "Risperidone|risperidone|053|6cm4|dopamine D₂ / 5-HT₂A|-|Antipsychotic|D2 / 5-HT2A antagonist · atypical antipsychotic",
    "Olanzapine|olanzapine|054|6cm4|dopamine D₂ / 5-HT₂A|-|Antipsychotic|multi-receptor antagonist · atypical antipsychotic (Zyprexa)",
    "Quetiapine|quetiapine|055|6cm4|dopamine D₂ / 5-HT₂A|-|Antipsychotic|D2 / 5-HT2A antagonist · atypical antipsychotic (Seroquel)",
    "Clozapine|clozapine|057|8jxv|dopamine D₄ receptor|-|Antipsychotic|multi-receptor atypical antipsychotic · treatment-resistant",
    "Haloperidol|haloperidol|052|6luq|dopamine D₂ receptor|-|Antipsychotic|D2 antagonist · typical antipsychotic",
    "Lithium|lithium|058|1pyx|GSK-3β / IMPase|-|Mood stabilizer|mood stabilizer · GSK-3 / inositol-depletion",
    "Lamotrigine|lamotrigine|059|8thh|voltage-gated Na⁺ channel|-|Anticonvulsant|voltage-gated Na+ channel blocker · mood stabilizer",
    "Valproate|valproate|079|8thh|Naᵥ / GABA-T / HDAC|-|Anticonvulsant|Na+ channel / GABAergic · anticonvulsant & mood stabilizer",
    "Gabapentin|gabapentin|080|7vfs|Caᵥ α₂δ-1 subunit|-|Anticonvulsant|α2δ voltage-gated Ca2+ channel ligand",
    "Pregabalin|pregabalin|040|7vfs|Caᵥ α₂δ-1 subunit|-|Anticonvulsant|α2δ Ca2+ channel ligand (Lyrica)",
    "Melatonin|melatonin|081|6me3|MT₁ / MT₂ receptors|-|Melatonin receptor agonist|MT1 / MT2 receptor agonist · circadian",
    "Diphenhydramine|diphenhydramine|067|3rze|histamine H₁ receptor|cholinergic?|Antihistamine|H1 antihistamine / antimuscarinic (Benadryl)",
    "Scopolamine|scopolamine|066|5cxv|muscarinic ACh receptor|cholinergic|Cholinergic|muscarinic acetylcholine antagonist",
    "Donepezil|donepezil|082|6o4w|acetylcholinesterase|cholinergic?|Anti-dementia agent|acetylcholinesterase inhibitor · Alzheimer’s",
    "GHB|ghb|037|7c7q|GABA-B receptor|sedative|Sedative|GABA-B & GHB-receptor agonist · Xyrem (narcolepsy)",
    "Mitragynine|kratom|071|7t2g|μ-opioid receptor|opioid|Opioid|kratom alkaloid · atypical μ-opioid partial agonist"

  ];

  var ROTATION = [], i, p;
  for (i = 0; i < ROWS.length; i++) {
    p = ROWS[i].split('|');
    ROTATION.push({
      name: p[0], slug: p[1], series: p[2], pdb: p[3], target: p[4],
      type: p[5], cls: p[6], note: p[7],
      href: '/drug-of-the-day/' + p[1] + '/', index: i
    });
  }

  var fmt = null;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: 'numeric', day: 'numeric' });
  } catch (e) { fmt = null; }

  // [year, month, day] of `date` on the Montréal calendar.
  function montrealYMD(date) {
    if (fmt && fmt.formatToParts) {
      var parts = fmt.formatToParts(date), o = {}, j;
      for (j = 0; j < parts.length; j++) o[parts[j].type] = parts[j].value;
      if (o.year && o.month && o.day) return [+o.year, +o.month, +o.day];
    }
    // Engine without time-zone support: fixed UTC−5. Exact in winter, one hour late in
    // summer. Still the same answer for every visitor on such an engine.
    var s = new Date(date.getTime() - 5 * 3600000);
    return [s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate()];
  }

  function dayNumber(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / DAY_MS); }
  var e = EPOCH.split('-');
  var EPOCH_DAY = dayNumber(+e[0], +e[1], +e[2]);

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(date) {
    var t = montrealYMD(date || new Date());
    return t[0] + '-' + pad(t[1]) + '-' + pad(t[2]);
  }
  function indexFor(date) {
    var t = montrealYMD(date || new Date());
    var n = ROTATION.length, k = dayNumber(t[0], t[1], t[2]) - EPOCH_DAY;
    return ((k % n) + n) % n;
  }
  function forDate(date) { return ROTATION[indexFor(date)]; }

  var api = {
    zone: ZONE, epoch: EPOCH, rotation: ROTATION,
    dateKey: dateKey, indexFor: indexFor, forDate: forDate,
    today: function () { return forDate(new Date()); }
  };
  root.LBP_DOTD = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
