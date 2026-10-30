"use strict";

window.RunModel = (() => {
  const stages = [
    { start: 0, end: 6, name: "Start from rest", v0: 0, v1: 8 },
    { start: 6, end: 27, name: "Cruise", v0: 8, v1: 8 },
    { start: 27, end: 37, name: "Middle surge", v0: 8, v1: 10 },
    { start: 37, end: 43, name: "Recover", v0: 10, v1: 8 },
    { start: 43, end: 55, name: "Cruise again", v0: 8, v1: 8 },
    { start: 55, end: 67, name: "Finishing kick", v0: 8, v1: 10 },
    { start: 67, end: 79, name: "Slow to a stop", v0: 10, v1: 0 }
  ];
  let mileMinutes = 0;
  const sections = Object.freeze(stages.map((stage) => {
    const hours = (stage.end - stage.start) / 60;
    const section = Object.freeze({
      ...stage, x0: mileMinutes / 60, a: (stage.v1 - stage.v0) / hours
    });
    mileMinutes += (stage.v0 + stage.v1) / 2 * (stage.end - stage.start);
    return section;
  }));
  const duration = sections.at(-1).end;
  const courseLength = mileMinutes / 60;

  function sectionAt(t) {
    return sections.find((section) => t < section.end) || sections.at(-1);
  }

  function position(t) {
    const section = sectionAt(t);
    const u = (t - section.start) / 60;
    return section.x0 + section.v0 * u + section.a / 2 * u ** 2;
  }

  function velocity(t) {
    const section = sectionAt(t);
    return section.v0 + section.a * (t - section.start) / 60;
  }

  function acceleration(t) {
    if (t === 0 || sections.some((section) => t === section.end)) return null;
    return sectionAt(t).a;
  }

  function interval(start, end) {
    let positive = 0;
    let negative = 0;
    for (const section of sections) {
      const minutes = Math.max(0, Math.min(end, section.end) - Math.max(start, section.start));
      const change = section.a * minutes / 60;
      positive += Math.max(0, change);
      negative += Math.min(0, change);
    }
    const displacement = position(end) - position(start);
    return {
      displacement,
      velocityChange: velocity(end) - velocity(start),
      positive,
      negative,
      averageVelocity: displacement / ((end - start) / 60)
    };
  }

  return Object.freeze({
    duration, position, velocity, acceleration, interval, sections, sectionAt,
    accelerationSections: Object.freeze(sections.map((section) => Object.freeze({
      start: section.start, end: section.end, value: section.a
    }))),
    ui: Object.freeze({
      timeShort: "min", timeLong: "minutes", axisTime: "hours",
      rateTime: 60, tickStep: 20, positionUnit: "mi", velocityUnit: "mph",
      accelerationUnit: "mph/hour", courseLength, positionDigits: 2,
      tickLabel: (t) => ({ 0: "0", 20: "1/3", 40: "2/3", 60: "1", 79: "79/60" })[t],
      ranges: [
        [0, 11, [0, 2, 4, 6, 8, 10], "position (miles)"],
        [0, 12, [0, 2, 4, 6, 8, 10], "velocity (mph)"],
        [-60, 100, [-50, -20, 0, 40, 80], "acceleration (mph/hour)"]
      ],
      phase: (t) => t === duration ? "Finished / at rest" : sectionAt(t).name
    })
  });
})();
