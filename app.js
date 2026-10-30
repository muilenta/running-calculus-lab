"use strict";

(() => {
  const model = window.RunModel;
  const ui = model.ui || {
    timeShort: "s", timeLong: "seconds", axisTime: "seconds",
    rateTime: 1, tickStep: 10, positionUnit: "m", velocityUnit: "m/s",
    accelerationUnit: "m/s\u00b2", courseLength: 255, positionDigits: 1,
    ranges: [
      [0, 280, [0, 70, 140, 210, 280], "position (m)"],
      [0, 7, [0, 2, 4, 6], "velocity (m/s)"],
      [-.8, .8, [-.8, -.4, 0, .4, .8], "acceleration (m/s\u00b2)"]
    ],
    phase: (t) => t === 0 ? "Ready to run" : t === 60 ? "Finished at rest" : t < 15 ? "Building speed" : t <= 40 ? "Cruising at 6 m/s" : "Easing down"
  };
  const $ = (id) => document.getElementById(id);
  const time = $("time");
  const start = $("interval-start");
  const end = $("interval-end");
  const tangents = $("show-tangents");
  const areas = $("show-areas");
  const secant = $("show-secant");
  const runnerSpeed = document.createElement("span");
  runnerSpeed.className = "runner-speed";
  runnerSpeed.id = "runner-speed";
  runnerSpeed.setAttribute("aria-hidden", "true");
  $("runner").append(runnerSpeed);
  const ns = "http://www.w3.org/2000/svg";
  const box = { left: 58, right: 874, top: 20, bottom: 188 };
  const tx = (t) => box.left + t / model.duration * (box.right - box.left);
  const fmt = (n, digits = 2) => (Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n).toFixed(digits);
  const signed = (n) => `${n > 0.005 ? "+" : ""}${fmt(n)}`;
  let playing = false;
  let previousFrame = null;
  let frameId = null;

  function element(tag, attributes = {}, text) {
    const node = document.createElementNS(ns, tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createChart(name, fn, min, max, ticks, unit) {
    const svg = $(`${name}-chart`);
    const ty = (y) => box.bottom - (y - min) / (max - min) * (box.bottom - box.top);
    const defs = element("defs");
    const clip = element("clipPath", { id: `${name}-clip` });
    clip.append(element("rect", { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top }));
    defs.append(clip);
    for (const [sign, y, height] of [
      ["positive", box.top, ty(0) - box.top],
      ["negative", ty(0), box.bottom - ty(0)]
    ]) {
      const region = element("clipPath", { id: `${name}-${sign}` });
      region.append(element("rect", { x: box.left, y, width: box.right - box.left, height }));
      defs.append(region);
    }
    svg.append(defs);
    ticks.forEach((value) => {
      svg.append(element("line", { x1: box.left, x2: box.right, y1: ty(value), y2: ty(value), class: value === 0 ? "axis" : "grid" }));
      svg.append(element("text", { x: box.left - 10, y: ty(value) + 4, "text-anchor": "end" }, String(value)));
    });
    const timeTicks = [];
    for (let t = 0; t <= model.duration; t += ui.tickStep) timeTicks.push(t);
    if (timeTicks.at(-1) !== model.duration) timeTicks.push(model.duration);
    timeTicks.forEach((t) => {
      svg.append(element("line", { x1: tx(t), x2: tx(t), y1: box.top, y2: box.bottom, class: "grid" }));
      const label = ui.tickLabel ? ui.tickLabel(t) : ui.rateTime === 1 ? String(t) : String(Number((t / ui.rateTime).toFixed(2)));
      svg.append(element("text", { x: tx(t), y: box.bottom + 20, "text-anchor": "middle" }, label));
    });
    svg.append(element("text", { x: box.left, y: 12 }, unit));
    svg.append(element("text", { x: box.right, y: 224, "text-anchor": "end" }, `time (${ui.axisTime})`));
    for (const marker of model.markers || []) {
      svg.append(element("line", { x1: tx(marker.time), x2: tx(marker.time), y1: box.top, y2: box.bottom, class: "milestone" }));
      svg.append(element("text", { x: tx(marker.time) - 5, y: 12, "text-anchor": "end", class: "milestone-label" }, marker.label));
    }
    const plot = element("g", { "clip-path": `url(#${name}-clip)` });
    const positiveArea = element("path", { fill: "#169b82", "fill-opacity": ".2", "clip-path": `url(#${name}-positive)` });
    const negativeArea = element("path", { fill: "#d47748", "fill-opacity": ".27", "clip-path": `url(#${name}-negative)` });
    const intervalLines = [0, 1].map(() => element("line", { y1: box.top, y2: box.bottom, class: "interval-guide" }));
    const steps = name === "acceleration" ? model.accelerationSections : null;
    const curvePath = steps
      ? steps.map((step) => `M${tx(step.start)},${ty(step.value)} L${tx(step.end)},${ty(step.value)}`).join(" ")
      : samplePath(fn, 0, model.duration, ty);
    const curve = element("path", { class: "curve", d: curvePath });
    const tangent = element("line", { class: "tangent" });
    const secantLine = element("line", { class: "secant" });
    const guide = element("line", { y1: box.top, y2: box.bottom, class: "time-guide" });
    const dot = element("circle", { r: 5, fill: "var(--chart-color)", stroke: "white", "stroke-width": 2 });
    const valueGuide = element("line", { class: "slope-value-guide" });
    const valueRing = element("circle", { r: 9, class: "slope-value-ring" });
    const slopeLabel = element("g", { class: "slope-label" });
    const slopeText = element("text", { x: 8, y: 16 });
    slopeLabel.append(element("rect", { width: 185, height: 24, rx: 5 }), slopeText);
    valueGuide.style.display = "none";
    valueRing.style.display = "none";
    slopeLabel.style.display = "none";
    plot.append(positiveArea, negativeArea, ...intervalLines, curve, secantLine, tangent, guide, valueGuide, valueRing, dot, slopeLabel);
    if (steps) {
      for (const step of steps) {
        for (const t of [step.start, step.end]) {
          plot.append(element("circle", {
            cx: tx(t), cy: ty(step.value), r: 3, fill: "white",
            stroke: "var(--chart-color)", "stroke-width": 1.5
          }));
        }
      }
    }
    svg.append(plot);
    return { name, fn, ty, plot, curve, positiveArea, negativeArea, intervalLines, tangent, secantLine, guide, dot, valueGuide, valueRing, slopeLabel, slopeText };
  }

  function samplePath(fn, from, to, ty) {
    const count = Math.max(2, Math.ceil((to - from) * (ui.samplesPerUnit ?? 8)));
    return Array.from({ length: count + 1 }, (_, i) => {
      const t = from + (to - from) * i / count;
      return `${i ? "L" : "M"}${tx(t).toFixed(3)},${ty(fn(t)).toFixed(3)}`;
    }).join(" ");
  }

  const charts = [
    createChart("position", model.position, ...ui.ranges[0]),
    createChart("velocity", model.velocity, ...ui.ranges[1]),
    createChart("acceleration", model.acceleration, ...ui.ranges[2])
  ];
  const sumChart = $("sum-chart") ? createChart("sum", model.velocity, ...ui.ranges[1]) : null;
  const sumRectangles = element("g");
  if (sumChart) {
    sumChart.plot.insertBefore(sumRectangles, sumChart.curve);
    sumChart.tangent.style.display = "none";
    sumChart.secantLine.style.display = "none";
    sumChart.intervalLines.forEach((node) => { node.style.display = "none"; });
  }

  function line(node, x1, y1, x2, y2) {
    Object.entries({ x1, y1, x2, y2 }).forEach(([key, value]) => node.setAttribute(key, value));
  }

  function renderTime() {
    const t = Number(time.value);
    const x = model.position(t);
    const v = model.velocity(t);
    const a = model.acceleration(t);
    const timeLabel = fmt(t, ui.timeDigits ?? 1);
    $("time-value").textContent = `${timeLabel} ${ui.timeShort}`;
    time.setAttribute("aria-valuetext", `${timeLabel} ${ui.timeLong}`);
    $("position-value").textContent = fmt(x, ui.positionDigits);
    $("velocity-value").textContent = fmt(v);
    $("acceleration-value").textContent = a === null ? "\u2014" : fmt(a);
    $("phase").textContent = ui.phase(t);
    const progress = Math.max(0, Math.min(100, x / ui.courseLength * 100));
    $("runner").style.left = `${progress}%`;
    $("track-fill").style.width = `${progress}%`;
    $("runner").classList.toggle("near-start", progress < 5);
    $("runner").classList.toggle("near-finish", progress > 95);
    $("runner").classList.toggle("returning", t >= (model.turnaround ?? Infinity));
    runnerSpeed.textContent = `${fmt(Math.abs(v), 1)} ${ui.velocityUnit}`;
    if ($("mile-pace")) {
      const secondsPerMile = v === 0 ? null : Math.round(1609.344 / Math.abs(v));
      $("mile-pace").textContent = secondsPerMile === null
        ? "Stopped"
        : `${Math.floor(secondsPerMile / 60)}:${String(secondsPerMile % 60).padStart(2, "0")} / mile`;
      $("pace-speed").textContent = `${fmt(Math.abs(v))} ${ui.velocityUnit}`;
    }
    const distance = model.totalDistance ? model.totalDistance(t) : x;
    $("runner-distance").textContent = `${fmt(distance, ui.positionDigits)} ${ui.positionUnit} traveled`;
    $("position-insight").innerHTML = `<span class="tangent-key">Position slope = velocity.</span> At ${timeLabel} ${ui.timeShort}, the tangent slope is ${fmt(v)} ${ui.velocityUnit}.`;
    $("velocity-insight").innerHTML = a === null
      ? '<span class="tangent-key">Section boundary.</span> At this instant there is no single two-sided velocity slope. Move inside a section to see its constant acceleration.'
      : `<span class="tangent-key">Velocity slope = acceleration.</span> At ${timeLabel} ${ui.timeShort}, the tangent slope is ${fmt(a)} ${ui.accelerationUnit}.`;
    $("acceleration-insight").textContent = a === null
      ? "An open circle marks an idealized switch: acceleration has no single value at that instant. The flat sections on either side are the one-sided rates."
      : Math.abs(a) < 1e-10
      ? "Acceleration is zero here: velocity is momentarily not changing. That does not necessarily mean you are stopped."
      : v === 0 ? "The runner is at rest at this instant."
        : `${a > 0 ? "Positive" : "Negative"} acceleration: velocity is ${a > 0 ? "increasing" : "decreasing"}. ${v < 0 ? "Heading home" : "Moving forward"} and ${v * a > 0 ? "speeding up" : "slowing down"}.`;
    if ($("speed-value")) $("speed-value").textContent = `${fmt(Math.abs(v))} mph`;

    charts.forEach((chart, index) => {
      const value = chart.fn(t);
      chart.guide.setAttribute("x1", tx(t));
      chart.guide.setAttribute("x2", tx(t));
      chart.dot.setAttribute("cx", tx(t));
      chart.dot.style.display = value === null ? "none" : "";
      if (value !== null) chart.dot.setAttribute("cy", chart.ty(value));
      const hasSlope = index === 0 || index === 1 && a !== null;
      chart.tangent.style.display = tangents.checked && hasSlope ? "" : "none";
      chart.slopeLabel.style.display = tangents.checked && hasSlope ? "" : "none";
      if (hasSlope) {
        const slope = (index === 0 ? v : a) / ui.rateTime;
        const left = Math.max(0, t - model.duration * 7 / 60);
        const right = Math.min(model.duration, t + model.duration * 7 / 60);
        line(chart.tangent, tx(left), chart.ty(value + slope * (left - t)), tx(right), chart.ty(value + slope * (right - t)));
        chart.slopeText.textContent = `slope = ${fmt(index === 0 ? v : a)} ${index === 0 ? ui.velocityUnit : ui.accelerationUnit}`;
        const labelX = Math.max(box.left + 4, Math.min(box.right - 189, tx(t) + 12));
        const labelY = Math.max(box.top + 4, Math.min(box.bottom - 28, chart.ty(value) - 35));
        chart.slopeLabel.setAttribute("transform", `translate(${labelX},${labelY})`);
      }
      const receivesSlope = tangents.checked && index > 0 && value !== null;
      chart.valueGuide.style.display = receivesSlope ? "" : "none";
      chart.valueRing.style.display = receivesSlope ? "" : "none";
      if (receivesSlope) {
        line(chart.valueGuide, box.left, chart.ty(value), tx(t), chart.ty(value));
        chart.valueRing.setAttribute("cx", tx(t));
        chart.valueRing.setAttribute("cy", chart.ty(value));
      }
      $(`${chart.name}-value`).closest(".reading").classList.toggle("linked-value", receivesSlope);
    });
    if ($("velocity-link")) {
      $("velocity-link").hidden = !tangents.checked;
      $("acceleration-link").hidden = !tangents.checked || a === null;
    }
    if ($("section-select")) renderSection(t);
    if (sumChart) renderSum(t);
    if (ui.accumulateToTime) {
      end.value = String(t);
      renderInterval();
    }
  }

  function polynomial(constant, linear = 0, quadratic = 0) {
    let expression = "";
    for (const [coefficient, variable] of [[constant, ""], [linear, "u"], [quadratic, "u\u00b2"]]) {
      if (coefficient === 0) continue;
      const magnitude = String(Math.abs(coefficient));
      const sign = expression ? (coefficient < 0 ? " - " : " + ") : coefficient < 0 ? "-" : "";
      expression += `${sign}${magnitude}${variable}`;
    }
    return expression || "0";
  }

  function renderSection(t) {
    const section = model.sectionAt(t);
    $("section-select").value = String(section.start);
    $("section-name").textContent = `${section.name} / ${section.start}\u2013${section.end} min`;
    $("section-clock").textContent = `Let u = hours since minute ${section.start}. Here u = (${fmt(t, 1)} - ${section.start}) / 60 = ${fmt((t - section.start) / 60, 4)} hours.`;
    $("position-equation").textContent = `x(u) = ${polynomial(section.x0, section.v0, section.a / 2)}`;
    $("velocity-equation-current").textContent = `v(u) = ${polynomial(section.v0, section.a)}`;
    $("acceleration-equation").textContent = `a(u) = ${section.a}`;
    $("antiderivative-equation").textContent = `Integrate velocity: ${polynomial(0, section.v0, section.a / 2)} + C. Starting position gives C = ${section.x0} miles.`;
    const distance = model.position(section.end) - model.position(section.start);
    $("section-integral").textContent = `Area over this section: integrate v(u) from u = 0 to ${section.end - section.start}/60 hours. Distance = ${fmt(distance, 3)} miles.`;
  }

  function renderSum(t) {
    const count = Number($("sum-slices").value);
    const sampling = $("sum-sampling") ? $("sum-sampling").value : "midpoint";
    const width = model.duration / count;
    let positive = 0;
    let negative = 0;
    let last = null;
    const rectangles = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const from = i * width;
      const to = Math.min(t, (i + 1) * width);
      if (from >= t) break;
      const sample = sampling === "left" ? from : sampling === "right" ? to : (from + to) / 2;
      const velocity = model.velocity(sample);
      const intervalWidth = (to - from) / ui.rateTime;
      const contribution = velocity * intervalWidth;
      positive += Math.max(0, contribution);
      negative += Math.min(0, contribution);
      rectangles.append(element("rect", {
        x: tx(from), y: Math.min(sumChart.ty(0), sumChart.ty(velocity)),
        width: tx(to) - tx(from), height: Math.abs(sumChart.ty(velocity) - sumChart.ty(0)),
        fill: contribution >= 0 ? "#169b82" : "#d47748",
        "fill-opacity": ".3", stroke: contribution >= 0 ? "#007f73" : "#bb502e", "stroke-width": ".7"
      }));
      last = { velocity, intervalWidth, contribution };
    }
    sumRectangles.replaceChildren(rectangles);
    line(sumChart.guide, tx(t), box.top, tx(t), box.bottom);
    sumChart.dot.setAttribute("cx", tx(t));
    sumChart.dot.setAttribute("cy", sumChart.ty(model.velocity(t)));
    $("sum-time").value = String(t);
    $("sum-time-value").textContent = `${fmt(t, ui.timeDigits ?? 1)} ${ui.timeShort}`;
    $("sum-position").textContent = `${fmt(positive + negative, 4)} ${ui.positionUnit}`;
    $("sum-exact").textContent = `${fmt(model.position(t), 4)} ${ui.positionUnit}`;
    $("sum-distance").textContent = `${fmt(positive - negative, 4)} ${ui.positionUnit}`;
    $("sum-parts").textContent = `Positive area ${fmt(positive, 4)} ${ui.positionUnit} + negative area ${fmt(negative, 4)} ${ui.positionUnit} = ${fmt(positive + negative, 4)} ${ui.positionUnit} estimated position.`;
    $("sum-slice-note").textContent = `${count} slices across the run; each full slice is ${fmt(width / ui.rateTime, 4)} ${ui.axisTime}. Filled slices stop at the selected time.`;
    $("sum-last").textContent = last
      ? `Newest slice: ${fmt(last.velocity, 3)} ${ui.velocityUnit} \u00d7 ${fmt(last.intervalWidth, 5)} ${ui.axisTime} = ${fmt(last.contribution, 5)} ${ui.positionUnit}.`
      : `At the start the sum is empty: position = 0 ${ui.positionUnit}. Press Play accumulation to add slices.`;
    $("sum-error").textContent = `${fmt(positive + negative - model.position(t), 4)} ${ui.positionUnit}`;
  }

  function renderInterval() {
    const from = Number(start.value);
    const to = Number(end.value);
    const result = model.interval(from, to);
    $("start-value").textContent = `${from} ${ui.timeShort}`;
    $("end-value").textContent = `${to} ${ui.timeShort}`;
    $("displacement").textContent = `${fmt(result.displacement)} ${ui.positionUnit}`;
    $("displacement-equation").textContent = `Final position - initial position = ${fmt(model.position(to))} - ${fmt(model.position(from))} ${ui.positionUnit}`;
    $("velocity-change").textContent = `${signed(result.velocityChange)} ${ui.velocityUnit}`;
    $("velocity-equation").textContent = `Final velocity - initial velocity = ${fmt(model.velocity(to))} - ${fmt(model.velocity(from))} ${ui.velocityUnit}`;
    $("signed-areas").textContent = `Positive area ${signed(result.positive)}; negative area ${signed(result.negative)} ${ui.velocityUnit}.`;
    const elapsed = ui.rateTime === 1 ? `${to - from} s` : `${fmt((to - from) / ui.rateTime, 3)} hours`;
    $("average-velocity").textContent = from === to
      ? "No elapsed time yet; average velocity needs a nonzero time interval."
      : `Average velocity: ${fmt(result.displacement)} ${ui.positionUnit} / ${elapsed} = ${fmt(result.averageVelocity)} ${ui.velocityUnit}.`;
    if ($("interval-distance")) {
      $("interval-distance").textContent = `${fmt(result.distance)} mi`;
      $("velocity-areas").textContent = `Outward area ${signed(result.outwardArea)} mi; homeward area ${signed(result.homewardArea)} mi.`;
      $("average-speed").textContent = `Average speed: ${fmt(result.averageSpeed)} mph. Distance adds both legs; displacement subtracts them.`;
    }
    charts.forEach((chart, index) => {
      const shade = areas.checked && index > 0;
      const steps = chart.name === "acceleration" ? model.accelerationSections : null;
      const path = steps
        ? steps.filter((step) => step.end > from && step.start < to).map((step) => {
          const left = tx(Math.max(from, step.start));
          const right = tx(Math.min(to, step.end));
          return `M${left},${chart.ty(0)} L${left},${chart.ty(step.value)} L${right},${chart.ty(step.value)} L${right},${chart.ty(0)} Z`;
        }).join(" ")
        : `${samplePath(chart.fn, from, to, chart.ty)} L${tx(to)},${chart.ty(0)} L${tx(from)},${chart.ty(0)} Z`;
      [chart.positiveArea, chart.negativeArea].forEach((node) => {
        node.setAttribute("d", path);
        node.style.display = shade ? "" : "none";
      });
      chart.intervalLines.forEach((node, i) => {
        node.setAttribute("x1", tx(i === 0 ? from : to));
        node.setAttribute("x2", tx(i === 0 ? from : to));
        node.style.display = areas.checked || secant.checked ? "" : "none";
      });
      chart.secantLine.style.display = secant.checked && index === 0 ? "" : "none";
      if (index === 0) line(chart.secantLine, tx(from), chart.ty(chart.fn(from)), tx(to), chart.ty(chart.fn(to)));
    });
  }

  function setPlaying(value) {
    playing = value;
    $("play").textContent = playing ? "Pause run" : "Play run";
    $("play").setAttribute("aria-pressed", String(playing));
    if ($("sum-play")) {
      $("sum-play").textContent = playing ? "Pause accumulation" : "Play accumulation";
      $("sum-play").setAttribute("aria-pressed", String(playing));
    }
    $("runner").classList.toggle("running", playing);
    previousFrame = null;
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = playing ? requestAnimationFrame(animate) : null;
  }

  function animate(timestamp) {
    if (!playing) return;
    if (previousFrame !== null) {
      // Keep sub-slider precision so high-refresh displays do not stall playback.
      animationTime = Math.min(model.duration, animationTime + (timestamp - previousFrame) / 1000 * Number($("speed").value));
      time.value = String(animationTime);
      renderTime();
    }
    previousFrame = timestamp;
    if (Number(time.value) >= model.duration) setPlaying(false);
    else frameId = requestAnimationFrame(animate);
  }

  let animationTime = Number(time.value);
  $("play").addEventListener("click", () => {
    if (!playing) {
      if (Number(time.value) >= model.duration) time.value = "0";
      animationTime = Number(time.value);
      renderTime();
    }
    setPlaying(!playing);
  });
  $("reset").addEventListener("click", () => {
    setPlaying(false);
    time.value = "0";
    renderTime();
  });
  time.addEventListener("input", () => { setPlaying(false); renderTime(); });
  document.querySelectorAll("svg.chart").forEach((svg) => {
    const scrub = (event) => {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const local = point.matrixTransform(svg.getScreenCTM().inverse());
      time.value = String(Math.max(0, Math.min(model.duration,
        (local.x - box.left) / (box.right - box.left) * model.duration)));
      renderTime();
    };
    svg.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      setPlaying(false);
      svg.setPointerCapture(event.pointerId);
      scrub(event);
    });
    svg.addEventListener("pointermove", (event) => {
      if (svg.hasPointerCapture(event.pointerId)) scrub(event);
    });
    svg.addEventListener("pointerup", (event) => {
      if (svg.hasPointerCapture(event.pointerId)) {
        scrub(event);
        svg.releasePointerCapture(event.pointerId);
      }
    });
    svg.addEventListener("pointercancel", (event) => {
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    });
  });
  if (sumChart) {
    $("sum-play").addEventListener("click", () => $("play").click());
    $("sum-reset").addEventListener("click", () => $("reset").click());
    $("sum-time").addEventListener("input", () => {
      setPlaying(false);
      time.value = $("sum-time").value;
      renderTime();
    });
    $("sum-slices").addEventListener("change", () => renderSum(Number(time.value)));
    if ($("sum-sampling")) $("sum-sampling").addEventListener("change", () => renderSum(Number(time.value)));
  }
  tangents.addEventListener("change", renderTime);
  areas.addEventListener("change", renderInterval);
  secant.addEventListener("change", renderInterval);
  start.addEventListener("input", () => {
    if (Number(start.value) >= Number(end.value)) end.value = String(Number(start.value) + 1);
    renderInterval();
  });
  end.addEventListener("input", () => {
    if (Number(end.value) <= Number(start.value)) start.value = String(Number(end.value) - 1);
    renderInterval();
  });

  function chooseInterval(from, to) {
    start.value = String(from);
    end.value = String(to);
    if (ui.accumulateToTime) {
      setPlaying(false);
      time.value = String(to);
      renderTime();
    } else {
      renderInterval();
    }
  }

  if ($("section-select")) {
    model.sections.forEach((section) => {
      const option = document.createElement("option");
      option.value = String(section.start);
      option.textContent = `${section.start}\u2013${section.end} min: ${section.name}`;
      $("section-select").append(option);
    });
    $("section-select").addEventListener("change", () => {
      const section = model.sections.find((item) => item.start === Number($("section-select").value));
      setPlaying(false);
      time.value = String((section.start + section.end) / 2);
      chooseInterval(section.start, section.end);
      renderTime();
    });
  }

  document.querySelectorAll(".preset").forEach((button) => {
    button.addEventListener("click", () => chooseInterval(Number(button.dataset.start), Number(button.dataset.end)));
  });
  document.querySelectorAll(".jump").forEach((button) => {
    button.addEventListener("click", () => {
      setPlaying(false);
      time.value = button.dataset.time;
      renderTime();
      $("run-title").scrollIntoView({ block: "start" });
    });
  });
  $("whole-run").addEventListener("click", () => {
    areas.checked = true;
    chooseInterval(0, model.duration);
    $("velocity-chart").scrollIntoView({ block: "center" });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && playing) setPlaying(false);
  });
  renderTime();
  renderInterval();
})();
