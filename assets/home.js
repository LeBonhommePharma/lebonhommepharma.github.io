/* ============================================================================
   home.js — behaviour for thebonhomme.com homepage.

   The homepage used to be a Claude Design bundle whose behaviour lived in a
   React component executed by a 66 KB dc-runtime. Unbundling froze the page,
   so these three behaviours are reimplemented here in plain JS with no
   framework and no build step.

   Everything below is recovered verbatim from the original bundle payload:
   the compound list, the day-of-year rotation rule, the theme palettes and
   the menu markup (which lives in index.html). Nothing is invented.
   ========================================================================= */
(function () {
  "use strict";

  /* ---- 1. Mobile menu --------------------------------------------------- */
  var burger = document.getElementById("nav-burger");
  var menu   = document.getElementById("nav-mobile-menu");

  if (burger && menu) {
    var setMenu = function (open) {
      menu.hidden = !open;
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    };
    var isOpen = function () { return !menu.hidden; };

    burger.addEventListener("click", function (e) {
      e.stopPropagation();
      setMenu(!isOpen());
    });

    // Close when a menu link is followed (matches the original closeMenu).
    Array.prototype.forEach.call(menu.querySelectorAll("a"), function (a) {
      a.addEventListener("click", function () { setMenu(false); });
    });

    // Escape closes and returns focus to the trigger.
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) { setMenu(false); burger.focus(); }
    });

    // Click outside closes.
    document.addEventListener("click", function (e) {
      if (isOpen() && !menu.contains(e.target) && e.target !== burger) setMenu(false);
    });

    // Viewport grew past the mobile breakpoint: drop the open state.
    if (window.matchMedia) {
      var wide = window.matchMedia("(min-width: 761px)");
      var onWide = function (ev) { if (ev.matches) setMenu(false); };
      if (wide.addEventListener) wide.addEventListener("change", onWide);
      else if (wide.addListener) wide.addListener(onWide);
    }

    setMenu(false);
  }

  /* ---- 2. Theme toggle -------------------------------------------------- */
  /* Palettes are the two <html data-theme> branches already in the page CSS;
     the body background values match the original _applyBodyBg(). */
  var BODY_BG = { night: "#0a0e14", day: "#e9edf5" };
  var group   = document.querySelector(".theme-toggle");
  var sun     = document.querySelector(".tg-btn.tg-sun");
  var moon    = document.querySelector(".tg-btn.tg-moon");

  function applyTheme(t, persist) {
    if (t !== "day" && t !== "night") t = "night";
    document.documentElement.setAttribute("data-theme", t);
    document.body.style.background = BODY_BG[t];
    if (group) group.setAttribute("data-mode", t);
    if (sun)  sun.setAttribute("aria-pressed", t === "day" ? "true" : "false");
    if (moon) moon.setAttribute("aria-pressed", t === "night" ? "true" : "false");
    if (persist) { try { localStorage.setItem("lbp-theme", t); } catch (e) {} }
  }

  // The pre-paint script in <head> already resolved this; re-apply so the
  // toggle chrome and body background agree with it.
  applyTheme(document.documentElement.getAttribute("data-theme") || "night", false);

  if (sun)  sun.addEventListener("click",  function () { applyTheme("day", true); });
  if (moon) moon.addEventListener("click", function () { applyTheme("night", true); });

  /* No prefers-color-scheme branch on purpose. The design system is explicit:
     "Do not introduce a light mode. The site is dark-first by design." The
     original component defaulted to night regardless of OS setting; day mode
     is opt-in through the toggle and then remembered. */

  /* ---- 3. Drug of the Day ----------------------------------------------- */
  /* Compound list and selection rule lifted verbatim from the bundle:
       doy   = floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000)
       today = drugs[doy % drugs.length]
     Entries carrying `live: true` deep-link to their own sub-page; the rest
     fall back to the index. */
  var drugs = [
  { name: "Cocaine HCl", slug: "cocaine", live: true, note: "competitive DAT/NET/SERT reuptake inhibitor · DAT Ki ≈ 250 nM" },
  { name: "MDMA", slug: "mdma", live: true, note: "substrate-mediated SERT/NET/DAT efflux · SERT Ki = 34 nM · FDA Breakthrough Therapy" },
  { name: "DMT", slug: "dmt", live: true, note: "endogenous 5-HT2A agonist · Ki ≈ 170 nM · near-zero tolerance" },
  { name: "Psilocin", slug: "psilocin", live: true, note: "psilocybin's active metabolite · 5-HT2A Ki ~107 nM" },
  { name: "LSD", slug: "lsd", live: true, note: "ergoline · 5-HT2A Ki ~1 nM · receptor lid-lock" },
  { name: "Amphetamine", slug: "amphetamine", live: true, note: "DAT/NET substrate-releaser · DAT Ki ~1,400 nM" },
  { name: "Fentanyl", slug: "fentanyl", live: true, note: "μ-opioid full agonist · MOR Ki ~1.1 nM · naloxone-reversible" },
  { name: "Salvinorin A", slug: "salvinorin-a", live: true, note: "κ-opioid full agonist · KOR Ki ~1.8 nM · non-serotonergic" },
  { name: "Ketamine", slug: "ketamine", note: "NMDA-receptor antagonist · dissociative anesthetic · esketamine FDA-approved for depression" },
  { name: "Methamphetamine", slug: "methamphetamine", note: "TAAR1 agonist & monoamine releaser · Schedule II (Desoxyn)" },
  { name: "Methylphenidate", slug: "methylphenidate", note: "DAT/NET reuptake inhibitor · ADHD (Ritalin)" },
  { name: "Lisdexamfetamine", slug: "lisdexamfetamine", note: "amphetamine prodrug · ADHD (Vyvanse)" },
  { name: "Modafinil", slug: "modafinil", note: "atypical DAT inhibitor · wakefulness-promoting (Provigil)" },
  { name: "Morphine", slug: "morphine", note: "μ-opioid full agonist · prototypical analgesic" },
  { name: "Oxycodone", slug: "oxycodone", note: "semi-synthetic μ-opioid full agonist" },
  { name: "Hydromorphone", slug: "hydromorphone", note: "μ-opioid full agonist · potent analgesic" },
  { name: "Codeine", slug: "codeine", note: "μ-opioid prodrug · CYP2D6 → morphine" },
  { name: "Tramadol", slug: "tramadol", note: "μ-opioid agonist + serotonin/NE reuptake inhibitor" },
  { name: "Methadone", slug: "methadone", note: "μ-opioid agonist + NMDA antagonist · OUD maintenance" },
  { name: "Buprenorphine", slug: "buprenorphine", note: "partial μ-opioid agonist / κ antagonist · OUD (Suboxone)" },
  { name: "Naloxone", slug: "naloxone", note: "competitive μ-opioid antagonist · overdose reversal (Narcan)" },
  { name: "Naltrexone", slug: "naltrexone", note: "opioid antagonist · alcohol & opioid use disorder" },
  { name: "Diazepam", slug: "diazepam", note: "GABA-A positive allosteric modulator · benzodiazepine (Valium)" },
  { name: "Alprazolam", slug: "alprazolam", note: "GABA-A PAM · benzodiazepine (Xanax)" },
  { name: "Clonazepam", slug: "clonazepam", note: "GABA-A PAM · benzodiazepine (Klonopin)" },
  { name: "Zolpidem", slug: "zolpidem", note: "GABA-A α1-selective PAM · Z-drug hypnotic (Ambien)" },
  { name: "Propofol", slug: "propofol", note: "GABA-A PAM · IV general anesthetic" },
  { name: "Nitrous Oxide", slug: "nitrous-oxide", note: "NMDA antagonist · inhaled anesthetic & analgesic" },
  { name: "Dextromethorphan", slug: "dextromethorphan", note: "NMDA antagonist / σ1 agonist · dissociative at high dose" },
  { name: "Memantine", slug: "memantine", note: "uncompetitive NMDA antagonist · Alzheimer's" },
  { name: "Caffeine", slug: "caffeine", note: "adenosine A1/A2A receptor antagonist" },
  { name: "Nicotine", slug: "nicotine", note: "nicotinic acetylcholine-receptor agonist" },
  { name: "Varenicline", slug: "varenicline", note: "α4β2 nicotinic partial agonist · smoking cessation (Chantix)" },
  { name: "THC", slug: "thc", note: "CB1/CB2 partial agonist · principal cannabinoid" },
  { name: "CBD", slug: "cbd", note: "non-euphoric cannabinoid · 5-HT1A / TRPV1 · FDA (Epidiolex)" },
  { name: "Psilocybin", slug: "psilocybin", note: "prodrug → psilocin · 5-HT2A agonist · Breakthrough Therapy" },
  { name: "Mescaline", slug: "mescaline", note: "phenethylamine 5-HT2A agonist" },
  { name: "2C-B", slug: "2c-b", note: "phenethylamine 5-HT2A agonist / partial" },
  { name: "Ibogaine", slug: "ibogaine", note: "multi-target (NMDA, opioid, σ) · anti-addictive" },
  { name: "Fluoxetine", slug: "fluoxetine", note: "SSRI · serotonin reuptake inhibitor (Prozac)" },
  { name: "Sertraline", slug: "sertraline", note: "SSRI (Zoloft)" },
  { name: "Escitalopram", slug: "escitalopram", note: "SSRI (Lexapro)" },
  { name: "Venlafaxine", slug: "venlafaxine", note: "SNRI · serotonin-norepinephrine reuptake inhibitor" },
  { name: "Duloxetine", slug: "duloxetine", note: "SNRI (Cymbalta)" },
  { name: "Bupropion", slug: "bupropion", note: "NDRI · norepinephrine-dopamine reuptake inhibitor (Wellbutrin)" },
  { name: "Buspirone", slug: "buspirone", note: "5-HT1A partial agonist · anxiolytic" },
  { name: "Aripiprazole", slug: "aripiprazole", note: "dopamine D2 partial agonist · atypical antipsychotic (Abilify)" },
  { name: "Risperidone", slug: "risperidone", note: "D2 / 5-HT2A antagonist · atypical antipsychotic" },
  { name: "Olanzapine", slug: "olanzapine", note: "multi-receptor antagonist · atypical antipsychotic (Zyprexa)" },
  { name: "Quetiapine", slug: "quetiapine", note: "D2 / 5-HT2A antagonist · atypical antipsychotic (Seroquel)" },
  { name: "Clozapine", slug: "clozapine", note: "multi-receptor atypical antipsychotic · treatment-resistant" },
  { name: "Haloperidol", slug: "haloperidol", note: "D2 antagonist · typical antipsychotic" },
  { name: "Lithium", slug: "lithium", note: "mood stabilizer · GSK-3 / inositol-depletion" },
  { name: "Lamotrigine", slug: "lamotrigine", note: "voltage-gated Na+ channel blocker · mood stabilizer" },
  { name: "Valproate", slug: "valproate", note: "Na+ channel / GABAergic · anticonvulsant & mood stabilizer" },
  { name: "Gabapentin", slug: "gabapentin", note: "α2δ voltage-gated Ca2+ channel ligand" },
  { name: "Pregabalin", slug: "pregabalin", note: "α2δ Ca2+ channel ligand (Lyrica)" },
  { name: "Melatonin", slug: "melatonin", note: "MT1 / MT2 receptor agonist · circadian" },
  { name: "Diphenhydramine", slug: "diphenhydramine", note: "H1 antihistamine / antimuscarinic (Benadryl)" },
  { name: "Scopolamine", slug: "scopolamine", note: "muscarinic acetylcholine antagonist" },
  { name: "Donepezil", slug: "donepezil", note: "acetylcholinesterase inhibitor · Alzheimer's" },
  { name: "GHB", slug: "ghb", note: "GABA-B & GHB-receptor agonist · Xyrem (narcolepsy)" },
  { name: "Mitragynine", slug: "kratom", note: "kratom alkaloid · atypical μ-opioid partial agonist" },
  ];

  function drugForDate(now) {
    var doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    return drugs[((doy % drugs.length) + drugs.length) % drugs.length];
  }

  function renderDrugOfTheDay(now) {
    var d = drugForDate(now || new Date());
    var link = document.getElementById("dod-link");
    var tag  = document.querySelector('[data-dod="tag"]');
    var desc = document.querySelector('[data-dod="desc"]');
    var cta  = document.querySelector('[data-dod="cta"]');
    var foot = document.querySelector('[data-dod="footer"]');
    var href = d.live
      ? "https://thebonhomme.com/drug-of-the-day/" + d.slug + "/"
      : "https://thebonhomme.com/drug-of-the-day/";
    if (link) link.setAttribute("href", href);
    if (tag)  tag.textContent  = "Today · " + d.name;
    if (cta)  cta.textContent  = "Today's drug — " + d.name;
    if (foot) foot.textContent = d.name;
    if (desc) desc.textContent = "Today: " + d.name + " — " + d.note +
      ". Rotates every day. Rigorous pharmacology plus entropy-docking commentary. Mechanism over moralising.";
    return d;
  }

  renderDrugOfTheDay();

  // exposed for verification
  window.__lbp = { drugs: drugs, drugForDate: drugForDate, renderDrugOfTheDay: renderDrugOfTheDay, applyTheme: applyTheme };
})();
