javascript:(async () => {
  // === Dr Frost autoloop bookmarklet ===
  // Loops through every question in the current task: oracles the answer,
  // fills inputs, clicks Submit, clicks Next, repeats until done. Stops on
  // task completion, unsupported answer shape, or the iteration cap.

  const MAX_ITER = 100;
  const $ = window.$ || window.jQuery;
  const MQ = window.MathQuill
    && window.MathQuill.getInterface
    && window.MathQuill.getInterface(2);

  const setMQ = (el, v) => {
    if (!MQ || !el) return false;
    const inst = MQ(el);
    if (!inst || !inst.latex) return false;
    inst.latex(String(v));
    return true;
  };
  const setInput = (el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const post = async (b) => {
    try {
      const r = await fetch('/api/tasks/submitanswer', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify(b)
      });
      if (!r.ok) return null;
      const t = await r.text();
      return t ? JSON.parse(t) : null;
    } catch (e) { return null; }
  };

  const findNextBtn = () => Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent.trim() === 'Next question' && b.offsetParent !== null);

  // Fill a single question's inputs given an oracle response.
  const fillQuestion = (active, type, ans) => {
    const mqFields = Array.from(active.querySelectorAll('.mq-editable-field'));
    const plainInputs = Array.from(active.querySelectorAll('input[type=text]'));
    const fillSlot = (i, v) => {
      if (mqFields[i] && setMQ(mqFields[i], v)) return true;
      if (plainInputs[i]) { setInput(plainInputs[i], v); return true; }
      return false;
    };

    if (type === 'expression'
        && ans
        && (typeof ans.main === 'string' || typeof ans.main === 'number')) {
      const mq = active.querySelector('#expression-answer, .mq-editable-field');
      if (mq && setMQ(mq, ans.main)) return true;
      if (plainInputs[0]) { setInput(plainInputs[0], ans.main); return true; }
      return false;
    }
    if (type === 'numeric' && Array.isArray(ans)) {
      const values = ans.map(o => o.exact ?? o.awrt ?? o.main ?? o.answer ?? o.from ?? o.to);
      values.forEach((v, i) => fillSlot(i, v));
      return true;
    }
    if (Array.isArray(ans) && Array.isArray(ans[0])) {
      // eqnsolutions
      const values = ans.flatMap(sln => sln.map(o => o.answer));
      values.forEach((v, i) => fillSlot(i, v));
      return true;
    }
    if (type === 'fraction' && ans && (ans.numer !== undefined
        || (Array.isArray(ans) && ans[0]?.numer !== undefined))) {
      const f = Array.isArray(ans) ? ans[0] : ans;
      const whole = active.querySelector('input[name=fraction-whole]');
      const numer = active.querySelector('input[name=fraction-numer]');
      const denom = active.querySelector('input[name=fraction-denom]');
      if (whole && f.whole !== undefined) setInput(whole, f.whole);
      if (numer) setInput(numer, f.numer);
      if (denom) setInput(denom, f.denom);
      return true;
    }
    if (type === 'multiplechoice' && (Array.isArray(ans) || typeof ans === 'number')) {
      const indices = Array.isArray(ans) ? ans : [ans];
      active.querySelectorAll('.multiplechoice-input').forEach(i => { i.checked = false; });
      for (const idx of indices) {
        const inp = active.querySelector(`.multiplechoice-input[value="${idx}"]`);
        if (inp) {
          inp.checked = true;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return true;
    }
    if (type === 'coordinate' && ans && ans.x !== undefined) {
      const x = active.querySelector('.expression-answer-x');
      const y = active.querySelector('.expression-answer-y');
      const z = active.querySelector('.expression-answer-z');
      if (x) setMQ(x, ans.x);
      if (y) setMQ(y, ans.y);
      if (z && ans.z !== undefined) setMQ(z, ans.z);
      return true;
    }
    if (type === 'standardform' && ans && ans.main !== undefined) {
      const main = active.querySelector('.expression-answer-main');
      const power = active.querySelector('.expression-answer-power');
      if (main) setMQ(main, ans.main);
      if (power) setMQ(power, ans.power);
      return true;
    }
    return false;
  };

  const log = [];

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // If a Next button is showing from a prior review, advance first.
    let nb = findNextBtn();
    if (nb) { nb.click(); await sleep(700); }

    const cur = $(document).data('taskState')?.question;
    if (!cur) { log.push(`iter ${iter}: no taskState — done`); break; }
    const ssid = cur.subskill?.ssid;
    const params = cur.params;

    // Wait for the form to populate with inputs.
    let active;
    let hasInputs = false;
    for (let i = 0; i < 25; i++) {
      active = Array.from(document.querySelectorAll('form.question-form'))
        .find(f => f.offsetParent !== null);
      if (active && (active.querySelectorAll('.mq-editable-field').length
          || active.querySelectorAll('input[type=text], input[type=checkbox], input[type=radio]').length)) {
        hasInputs = true;
        break;
      }
      await sleep(200);
    }
    if (!hasInputs) { log.push(`iter ${iter}: form has no inputs`); break; }

    // Oracle the answer.
    let ans, type;
    for (const userAnswer of [
      '0',
      [[{ operator: '=', answer: '0' }]],
      [[{ operator: '=', answer: '0' }, { operator: '=', answer: '0' }]]
    ]) {
      const sj = await post({ userAnswer, qnum: 0, aaid: 0, ssid, params });
      if (sj?.question?.answer?.correctAnswer !== undefined) {
        ans = sj.question.answer.correctAnswer;
        type = sj.question.answer.type;
        break;
      }
    }
    if (ans === undefined) { log.push(`iter ${iter}: oracle failed ssid=${ssid}`); break; }

    if (!fillQuestion(active, type, ans)) {
      log.push(`iter ${iter}: unsupported type=${type} ans=${JSON.stringify(ans).slice(0, 80)}`);
      break;
    }
    log.push(`iter ${iter}: ssid=${ssid} type=${type} ans=${JSON.stringify(ans).slice(0, 60)}`);

    await sleep(250);

    const sub = active.querySelector('input[type=submit]');
    if (sub) sub.click(); else { log.push(`iter ${iter}: no submit btn`); break; }

    // Wait for Next button to appear.
    let next = null;
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      next = findNextBtn();
      if (next) break;
    }
    if (!next) { log.push(`iter ${iter}: no Next btn — task may be complete`); break; }

    const prevSsid = ssid;
    const prevParams = JSON.stringify(params);
    next.click();

    // Wait until taskState reflects a new question.
    let advanced = false;
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      const c2 = $(document).data('taskState')?.question;
      if (c2 && (c2.subskill?.ssid !== prevSsid || JSON.stringify(c2.params) !== prevParams)) {
        advanced = true;
        break;
      }
    }
    if (!advanced) { log.push(`iter ${iter}: didn't advance`); break; }
  }

  console.log('[DFM autoloop]', log);
  alert(`DFM autoloop: ${log.length} iterations. Console has the full log.`);
})();
