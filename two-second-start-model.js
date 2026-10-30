"use strict";

window.RunModel = (() => {
  const duration = 2.5;
  const position = (t) => t ** 2;
  const velocity = (t) => 2 * t;
  const acceleration = () => 2;

  function interval(start, end) {
    const displacement = position(end) - position(start);
    const velocityChange = velocity(end) - velocity(start);
    return {
      displacement, velocityChange,
      positive: velocityChange, negative: 0,
      averageVelocity: end === start ? null : displacement / (end - start)
    };
  }

  return Object.freeze({
    duration, position, velocity, acceleration, interval,
    ui: Object.freeze({
      timeShort: "s", timeLong: "seconds", axisTime: "seconds", timeDigits: 2,
      rateTime: 1, tickStep: 0.5, samplesPerUnit: 80, accumulateToTime: true,
      positionUnit: "m", velocityUnit: "m/s", accelerationUnit: "m/s\u00b2",
      courseLength: 6.25, positionDigits: 2,
      ranges: [
        [0, 7, [0, 1, 2, 3, 4, 5, 6], "position (meters)"],
        [0, 5.5, [0, 1, 2, 3, 4, 5], "velocity (m/s)"],
        [0, 2.5, [0, 0.5, 1, 1.5, 2, 2.5], "acceleration (m/s\u00b2)"]
      ],
      phase: (t) => t === 0 ? "At rest / ready to go" : t === duration ? "5 m/s reached" : "Accelerating at 2 m/s\u00b2"
    })
  });
})();
