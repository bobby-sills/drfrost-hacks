javascript:(async () => {
  // === Dr Frost answer bookmarklet ===
  // On click: reads (ssid, params) from the page's task state, queries the
  // free oracle endpoint (submitanswer with aaid:0, qnum:0 — no real-task
  // side effects), then fills the answer into the page's input widget.

  const $ = window.$ || window.jQuery;
  const ts = $(document).data('taskState');
  const cur = ts && ts.question;
  if (!cur) return alert('No current question.');

  const ssid = cur.subskill && cur.subskill.ssid;
  const params = cur.params;

  // ---- Oracle call ----
  const post = b => fetch('/api/tasks/submitanswer', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify(b)
  }).then(r => r.json());

  // Try a few userAnswer shapes — server rejects bad shapes with warn:true.
  let resp;
  for (const userAnswer of [
    '0',
    [[{ operator: '=', answer: '0' }]],
    [[{ operator: '=', answer: '0' }, { operator: '=', answer: '0' }]]
  ]) {
    const sj = await post({ userAnswer, qnum: 0, aaid: 0, ssid, params });
    if (sj.question && sj.question.answer && sj.question.answer.correctAnswer !== undefined) {
      resp = sj;
      break;
    }
  }
  if (!resp) return alert('Oracle failed.');

  const ans = resp.question.answer.correctAnswer;
  const type = resp.question.answer.type;
  console.log('[DFM]', type, ans);

  // ---- Find the active question form ----
  const forms = Array.from(document.querySelectorAll('form.question-form'));
  const active = forms.find(f => f.offsetParent !== null);
  if (!active) return alert('No active form.');

  // ---- Setters ----
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

  // Fill one value into the i-th input — MathQuill first, plain <input> fallback.
  const fillSlot = (i, v, mqFields, plainInputs) => {
    if (mqFields[i] && setMQ(mqFields[i], v)) return true;
    if (plainInputs[i]) { setInput(plainInputs[i], v); return true; }
    return false;
  };

  const mqFields = Array.from(active.querySelectorAll('.mq-editable-field'));
  const plainInputs = Array.from(active.querySelectorAll('input[type=text]'));

  // ---- Dispatch by answer type ----
  if (type === 'expression'
      && ans
      && (typeof ans.main === 'string' || typeof ans.main === 'number')) {
    // Single-field expression — main is a LaTeX string or number
    const mq = active.querySelector('#expression-answer, .mq-editable-field');
    if (mq && setMQ(mq, ans.main)) return;
    if (plainInputs[0]) { setInput(plainInputs[0], ans.main); return; }
    alert('Could not find input.');
  } else if (type === 'numeric' && Array.isArray(ans)) {
    // Numeric — array of {exact?|awrt?|from/to?|...} objects, one per row.
    // `from`/`to` is a range; any value in [from, to] is accepted — pick `from`.
    const values = ans.map(o => o.exact ?? o.awrt ?? o.main ?? o.answer ?? o.from ?? o.to);
    values.forEach((v, i) => fillSlot(i, v, mqFields, plainInputs));
  } else if (Array.isArray(ans) && Array.isArray(ans[0])) {
    // eqnsolutions — outer array = solutions, inner = variables.
    // Flatten so each cell maps to one input slot in DOM order.
    const values = ans.flatMap(sln => sln.map(o => o.answer));
    values.forEach((v, i) => fillSlot(i, v, mqFields, plainInputs));
  } else if (type === 'fraction' && ans && (ans.numer !== undefined || (Array.isArray(ans) && ans[0]?.numer !== undefined))) {
    // fraction — {whole?, numer, denom}. Plain inputs by name.
    const f = Array.isArray(ans) ? ans[0] : ans;
    const whole = active.querySelector('input[name=fraction-whole]');
    const numer = active.querySelector('input[name=fraction-numer]');
    const denom = active.querySelector('input[name=fraction-denom]');
    if (whole && f.whole !== undefined) setInput(whole, f.whole);
    if (numer) setInput(numer, f.numer);
    if (denom) setInput(denom, f.denom);
  } else if (type === 'multiplechoice' && (Array.isArray(ans) || typeof ans === 'number')) {
    // multiplechoice — array of 1-based indices (multi-select) or just a number (single-select).
    const indices = Array.isArray(ans) ? ans : [ans];
    active.querySelectorAll('.multiplechoice-input').forEach(inp => { inp.checked = false; });
    for (const idx of indices) {
      const inp = active.querySelector(`.multiplechoice-input[value="${idx}"]`);
      if (inp) {
        inp.checked = true;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  } else if (type === 'coordinate' && ans && ans.x !== undefined) {
    // coordinate — {x, y, z?} in MathQuill .expression-answer-x/y/z fields.
    const x = active.querySelector('.expression-answer-x');
    const y = active.querySelector('.expression-answer-y');
    const z = active.querySelector('.expression-answer-z');
    if (x) setMQ(x, ans.x);
    if (y) setMQ(y, ans.y);
    if (z && ans.z !== undefined) setMQ(z, ans.z);
  } else if (type === 'standardform' && ans && ans.main !== undefined) {
    // standardform — {main, power} into .expression-answer-main/-power MathQuill fields.
    const main = active.querySelector('.expression-answer-main');
    const power = active.querySelector('.expression-answer-power');
    if (main) setMQ(main, ans.main);
    if (power) setMQ(power, ans.power);
  } else {
    alert('Unhandled answer shape; printed to console.');
  }
})();
