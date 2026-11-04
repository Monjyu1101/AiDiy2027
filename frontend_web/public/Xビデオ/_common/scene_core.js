function renderScenePage(forcedIndex) {
  const scenario = window.SCENARIO;
  let index;
  if (forcedIndex !== undefined) {
    index = Math.min(Math.max(forcedIndex, 0), scenario.scenes.length - 1);
  } else {
    const params = new URLSearchParams(window.location.search);
    const requested = Number.parseInt(params.get("n") || "1", 10);
    index = Number.isFinite(requested)
      ? Math.min(Math.max(requested - 1, 0), scenario.scenes.length - 1)
      : 0;
  }
  const scene = scenario.scenes[index];
  const stage = document.getElementById("stage");
  const contentPanel = document.getElementById("contentPanel");

  document.documentElement.style.setProperty("--accent", scene.accent || "#29d8ff");
  document.documentElement.style.setProperty("--accent-soft", scene.accent_soft || "rgba(41, 216, 255, 0.18)");

  const kicker = document.getElementById("kicker");
  const sceneId = document.getElementById("sceneId");
  const sceneTitle = document.getElementById("sceneTitle");
  const headline = document.getElementById("headline");
  const lead = document.getElementById("lead");
  const chips = document.getElementById("chips");
  const metrics = document.getElementById("metrics");
  const cards = document.getElementById("cards");
  const facts = document.getElementById("facts");
  const evidence = document.getElementById("evidence");
  const sceneImage = document.getElementById("sceneImage");
  const imagePlaceholder = document.getElementById("imagePlaceholder");
  const backgroundWord = document.getElementById("backgroundWord");
  const imageKicker = document.getElementById("imageKicker");
  const imageTitle = document.getElementById("imageTitle");
  const imageHeadline = document.getElementById("imageHeadline");
  const imageSubtitle = document.getElementById("imageSubtitle");
  const imageLead = document.getElementById("imageLead");
  const isSplash = scene.layout === "splash";
  const isHero = scene.layout === "hero";
  const isHeroImageFocus = isHero && Boolean(scene.hero_image_focus);

  stage.classList.toggle("stage-splash", isSplash);
  stage.classList.toggle("stage-hero", isHero);
  stage.classList.toggle("stage-hero-focus", isHeroImageFocus);
  contentPanel.hidden = isSplash || isHero;

  kicker.textContent = scene.kicker || "";
  sceneId.textContent = `${scene.id} / ${index + 1} of ${scenario.scenes.length}`;
  sceneTitle.textContent = scene.title || "";
  lead.textContent = scene.lead || "";
  backgroundWord.textContent = (isSplash || isHero) ? (scene.background_word || "") : "";
  imageKicker.textContent = (isSplash || isHero) ? (scene.kicker || "") : "";
  imageTitle.textContent = scene.title || "";
  imageLead.textContent = (isSplash || isHero) ? (scene.lead || "") : "";
  imageSubtitle.textContent = scene.subtitle || scene.lead || "";
  sceneImage.alt = scene.title || "";

  function fillHeadline(target, text) {
    target.textContent = "";
    if (!text) return;
    String(text || "")
      .split("\n")
      .forEach((line) => {
        const span = document.createElement("span");
        span.className = "headline-line";
        span.textContent = line;
        target.appendChild(span);
      });
  }

  fillHeadline(headline, scene.headline || "");
  fillHeadline(imageHeadline, (isSplash || isHero) ? (scene.headline || "") : "");

  if (scene.image) {
    sceneImage.style.display = "";
    sceneImage.classList.remove("loaded");
    const handleLoad = () => {
      sceneImage.classList.add("loaded");
      imagePlaceholder.style.display = "none";
    };
    const handleError = () => {
      imagePlaceholder.textContent = "画像を表示できません";
      imagePlaceholder.style.display = "flex";
    };
    sceneImage.addEventListener("load", handleLoad, { once: true });
    sceneImage.addEventListener("error", handleError, { once: true });
    sceneImage.src = scene.image;
    if (sceneImage.complete && sceneImage.naturalWidth > 0) {
      handleLoad();
    }
  } else {
    sceneImage.removeAttribute("src");
    sceneImage.style.display = "none";
    imagePlaceholder.style.display = (isSplash || isHero) ? "none" : "flex";
    imagePlaceholder.textContent = "画像未生成";
  }

  if ((isSplash || isHero) && !scene.image) {
    imagePlaceholder.style.display = "none";
  }

  chips.innerHTML = "";
  (scene.chips || []).forEach((value) => {
    const el = document.createElement("div");
    el.className = "chip";
    el.textContent = value;
    chips.appendChild(el);
  });

  metrics.innerHTML = "";
  (scene.metrics || []).forEach((item) => {
    const card = document.createElement("div");
    card.className = "metric-card";
    const label = document.createElement("div");
    label.className = "metric-label";
    label.textContent = item.label || "";
    const value = document.createElement("div");
    value.className = "metric-value";
    value.textContent = item.value || "";
    card.appendChild(label);
    card.appendChild(value);
    metrics.appendChild(card);
  });

  cards.innerHTML = "";
  (scene.cards || []).forEach((item) => {
    const card = document.createElement("section");
    card.className = "fact-card";
    const title = document.createElement("h3");
    title.className = "fact-card-title";
    title.textContent = item.title || "";
    const list = document.createElement("ul");
    list.className = "fact-card-list";
    (item.lines || []).forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    });
    card.appendChild(title);
    card.appendChild(list);
    cards.appendChild(card);
  });

  facts.innerHTML = "";
  (scene.factual_bullets || scene.facts || []).forEach((text) => {
    const item = document.createElement("div");
    item.className = "fact-item";
    const p = document.createElement("p");
    p.className = "fact-text";
    p.textContent = text;
    item.appendChild(p);
    facts.appendChild(item);
  });

  const dialogue = document.getElementById("dialogue");
  if (dialogue) {
    dialogue.innerHTML = "";
    (scene.dialogue || []).forEach((item) => {
      const line = document.createElement("div");
      line.className = `dialogue-line dialogue-${item.speaker || "female"}`;
      const speaker = document.createElement("span");
      speaker.className = "dialogue-speaker";
      speaker.textContent = item.speaker === "male" ? "男性" : "女性";
      const body = document.createElement("div");
      body.className = "dialogue-body";
      if (item.telop_text) {
        const telop = document.createElement("p");
        telop.className = "dialogue-telop";
        telop.textContent = item.telop_text;
        body.appendChild(telop);
      }
      if (item.naration_text) {
        const narration = document.createElement("p");
        narration.className = "dialogue-narration";
        narration.textContent = item.naration_text;
        body.appendChild(narration);
      }
      line.appendChild(speaker);
      line.appendChild(body);
      dialogue.appendChild(line);
    });
  }

  evidence.innerHTML = "";
  (scene.evidence || []).forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.className = "evidence-item";
    const source = document.createElement("div");
    source.className = "evidence-source";
    source.textContent = item.source || "";
    const text = document.createElement("p");
    text.className = "evidence-text";
    text.textContent = item.text || "";
    wrapper.appendChild(source);
    wrapper.appendChild(text);
    evidence.appendChild(wrapper);
  });
}
