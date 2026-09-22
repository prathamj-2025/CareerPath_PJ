/* CareerPath prototype.
   Two roles share one application: students learn and get assessed, admins manage
   content. All state is in memory for the session. */
(function () {
  "use strict";

  var ROLES = window.CP_ROLES;
  var LEVELS = window.CP_LEVELS;
  var SCHOOLS = ["USC", "UCLA", "NYU", "Georgia Tech", "UT Austin", "University of Michigan"];
  var MAJORS = ["Engineering Management", "Computer Science", "Business Administration",
                "Industrial Engineering", "Economics", "Data Science", "Information Systems"];

  var STAR = "&#9733;";

  /* ---------------- state ---------------- */

  var state = {
    users: [],
    userId: null,
    route: { name: "roadmap" },
    authTab: "login",
    authError: "",
    lessonIdx: 0,
    practiceState: {},    // key -> { hints revealed, answer shown, learner's attempt }
    quiz: null,
    exam: null,
    result: null,
    preview: null,        // { roleId, skillId, user }  set while an admin previews content
    adminSkill: null,     // { roleId, skillId }
    adminEdit: null,      // qid being edited, or "new"
    adminLesson: null,    // lesson index being edited
    adminHistory: null,   // qid whose version history is open
    adminStudent: null,   // student id whose profile is open
    studentFilter: { role: "all", school: "all", q: "" }
  };

  function uid() { return "u" + Math.random().toString(36).slice(2, 9); }

  function newUser(o) {
    return {
      id: uid(), name: o.name, email: o.email, password: o.password,
      role: o.role || "student",
      school: o.school, major: o.major, gradYear: o.gradYear, title: o.title || "",
      roleId: o.roleId || null, points: o.points || 0,
      progress: o.progress || {},
      seeded: !!o.seeded
    };
  }

  function prog(user, skillId) {
    if (!user.progress[skillId]) {
      user.progress[skillId] = { stars: 0, best: 0, attempts: 0, project: false, lessonsDone: [], history: [] };
    }
    return user.progress[skillId];
  }

  function me() { return state.users.filter(function (u) { return u.id === state.userId; })[0] || null; }
  function actor() { return state.preview ? state.preview.user : me(); }
  function isAdmin() { var u = me(); return !!u && u.role === "admin"; }

  function role(id) { return ROLES.filter(function (r) { return r.id === id; })[0] || null; }
  function skill(roleId, skillId) {
    var r = role(roleId); if (!r) return null;
    return r.skills.filter(function (s) { return s.id === skillId; })[0] || null;
  }
  function allSkills() {
    var out = [];
    ROLES.forEach(function (r) { r.skills.forEach(function (s) { out.push({ role: r, skill: s }); }); });
    return out;
  }

  /* ---------------- content versioning ----------------
     Graded content is versioned. An admin edit creates a draft; publishing
     retires the current version into the archive and raises the version number,
     so a score recorded against v2 stays explainable after v3 goes live. */

  function ensureVersioning() {
    allSkills().forEach(function (x) {
      var s = x.skill;
      if (!s.drafts) s.drafts = [];
      if (!s.archive) s.archive = [];
      s.assessment.forEach(function (q, i) {
        if (!q.qid) q.qid = s.id + "-q" + (i + 1);
        if (!q.v) q.v = 1;
      });
    });
  }

  function findQ(s, qid) {
    return s.assessment.filter(function (q) { return q.qid === qid; })[0] || null;
  }
  function draftFor(s, qid) {
    return s.drafts.filter(function (d) { return d.qid === qid; })[0] || null;
  }
  function allDrafts() {
    var out = [];
    allSkills().forEach(function (x) {
      x.skill.drafts.forEach(function (d) { out.push({ role: x.role, skill: x.skill, draft: d }); });
    });
    return out;
  }
  function archiveFor(s, qid) {
    return s.archive.filter(function (a) { return a.qid === qid; });
  }

  function publishDraft(s, qid) {
    var d = draftFor(s, qid);
    if (!d) return;
    if (d.isNew) {
      var nq = { qid: qid, v: 1, lvl: d.fields.lvl, q: d.fields.q, opts: d.fields.opts.slice(), a: d.fields.a, why: d.fields.why };
      s.assessment.push(nq);
    } else {
      var q = findQ(s, qid);
      if (q) {
        s.archive.push({ qid: qid, v: q.v, retired: today(),
          fields: { q: q.q, opts: q.opts.slice(), a: q.a, lvl: q.lvl, why: q.why } });
        q.q = d.fields.q; q.opts = d.fields.opts.slice(); q.a = d.fields.a;
        q.lvl = d.fields.lvl; q.why = d.fields.why; q.v = q.v + 1;
      }
    }
    s.drafts = s.drafts.filter(function (x) { return x.qid !== qid; });
  }

  function retireQuestion(s, qid) {
    var q = findQ(s, qid);
    if (!q) return;
    s.archive.push({ qid: qid, v: q.v, retired: today(), retiredOut: true,
      fields: { q: q.q, opts: q.opts.slice(), a: q.a, lvl: q.lvl, why: q.why } });
    s.assessment = s.assessment.filter(function (x) { return x.qid !== qid; });
    s.drafts = s.drafts.filter(function (x) { return x.qid !== qid; });
  }

  /* ---------------- scoring ---------------- */

  function levelFor(pct) {
    var lv = LEVELS[0];
    LEVELS.forEach(function (l) { if (pct >= l.min) lv = l; });
    return lv;
  }

  function awardFor(pct, projectDone) {
    var lv = levelFor(pct);
    if (lv.stars === 5 && !projectDone) return { stars: 4, label: LEVELS[4].label, capped: true };
    return { stars: lv.stars, label: lv.label, capped: false };
  }

  function starHTML(n, size) {
    var s = '<span class="stars"' + (size ? ' style="font-size:' + size + '"' : "") + ">";
    for (var i = 1; i <= 5; i++) s += i <= n ? STAR : '<span class="off">' + STAR + "</span>";
    return s + "</span>";
  }

  function totalStars(user) {
    var r = role(user.roleId); if (!r) return 0;
    return r.skills.reduce(function (a, s) { return a + prog(user, s.id).stars; }, 0);
  }
  function maxStars(user) { var r = role(user.roleId); return r ? r.skills.length * 5 : 0; }
  function verifiedCount(user) {
    var r = role(user.roleId); if (!r) return 0;
    return r.skills.filter(function (s) { return prog(user, s.id).stars > 0; }).length;
  }
  function certsFor(user) {
    var r = role(user.roleId); if (!r) return [];
    return r.skills.filter(function (s) { return prog(user, s.id).stars >= 3; })
      .map(function (s) { return { skill: s, p: prog(user, s.id) }; });
  }
  function verifyId(user, skillId) {
    var src = user.id + "|" + user.roleId + "|" + skillId;
    var h = 0;
    for (var i = 0; i < src.length; i++) { h = (h * 31 + src.charCodeAt(i)) >>> 0; }
    var code = h.toString(36).toUpperCase().slice(0, 6);
    while (code.length < 6) code = "0" + code;
    return "CP-" + user.roleId.toUpperCase() + "-" + code;
  }

  /* ---------------- seed ---------------- */

  function seed() {
    var student = newUser({
      name: "Pratham Jain", email: "student@careerpath.com", password: "student", role: "student",
      school: "USC", major: "Engineering Management", gradYear: "2027", roleId: "pm"
    });
    student.progress["sql-pm"] = { stars: 3, best: 80, attempts: 2, project: false, lessonsDone: [0, 1, 2, 3],
      history: [{ pct: 60, stars: 1, when: "Sep 12, 2026" }, { pct: 80, stars: 3, when: "Sep 18, 2026" }] };
    student.progress["metrics-pm"] = { stars: 2, best: 70, attempts: 1, project: false, lessonsDone: [0, 1],
      history: [{ pct: 70, stars: 2, when: "Sep 16, 2026" }] };
    student.points = 500;
    state.users.push(student);

    state.users.push(newUser({
      name: "Dana Whitfield", email: "admin@careerpath.com", password: "admin", role: "admin",
      title: "Content Manager", school: "CareerPath", major: "", gradYear: ""
    }));

    var classmates = [
      ["Priya Chavan", "USC", "pm", 1400, 5], ["Marcus Webb", "USC", "pm", 1100, 4],
      ["Ana Ruiz", "USC", "pm", 900, 4], ["Dev Patel", "USC", "pm", 400, 2],
      ["Sarah Kim", "USC", "pm", 300, 2], ["Tom Alvarez", "USC", "pm", 200, 1],
      ["Jing Liu", "USC", "ba", 1250, 5], ["Noor Hassan", "USC", "ba", 800, 3],
      ["Ellie Brandt", "USC", "da", 1500, 5], ["Raj Menon", "UCLA", "pm", 1600, 5]
    ];
    classmates.forEach(function (c) {
      var u = newUser({ name: c[0], school: c[1],
        email: c[0].split(" ")[0].toLowerCase() + "@" + (c[1] === "USC" ? "usc.edu" : "ucla.edu"),
        password: "-", major: "Engineering Management", gradYear: "2027", roleId: c[2], points: c[3], seeded: true });
      var r = role(c[2]);
      r.skills.forEach(function (s, i) {
        if (i < c[4]) {
          var st = Math.max(1, 5 - i);
          u.progress[s.id] = { stars: st, best: 60 + st * 7, attempts: 1, project: st === 5,
            lessonsDone: [0, 1, 2], history: [{ pct: 60 + st * 7, stars: st, when: "Sep 2026" }] };
        }
      });
      state.users.push(u);
    });
  }

  /* ---------------- helpers ---------------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function initials(name) {
    return name.split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
  }
  function today() {
    return new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
  function paras(text) {
    return text.split("\n\n").map(function (p) {
      if (/^(SELECT|WITH)/.test(p.trim())) return "<pre>" + esc(p) + "</pre>";
      return "<p>" + esc(p) + "</p>";
    }).join("");
  }
  function go(name, params) {
    state.route = Object.assign({ name: name }, params || {});
    window.scrollTo(0, 0);
    render();
  }
  function summaryCell(k, v) {
    return '<div class="summary-cell"><div class="k">' + k + '</div><div class="v mono">' + v + "</div></div>";
  }

  /* ---------------- auth ---------------- */

  function renderAuth() {
    var isSignup = state.authTab === "signup";
    var el = document.getElementById("auth");
    el.hidden = false;
    document.getElementById("shell").hidden = true;

    el.innerHTML =
      '<div class="auth-aside">' +
        '<div class="brand"><div class="brand-mark">CP</div><div class="brand-name">CareerPath</div></div>' +
        '<div><div class="auth-claim">Choose your career.<br>Learn the skills.<br><em>Prove you know them.</em></div></div>' +
        '<div class="auth-points">' +
          '<div><b>01</b><span>Pick a target role and get the full skill roadmap for it.</span></div>' +
          '<div><b>02</b><span>Learn each skill through your role&rsquo;s lens, or test straight out.</span></div>' +
          '<div><b>03</b><span>Earn verified stars. Progress only moves through assessment.</span></div>' +
        "</div>" +
      "</div>" +
      '<div class="auth-form-wrap"><div class="auth-form">' +
        '<div class="tabs" role="tablist">' +
          '<button role="tab" aria-selected="' + isSignup + '" data-action="auth-tab" data-tab="signup">Create account</button>' +
          '<button role="tab" aria-selected="' + !isSignup + '" data-action="auth-tab" data-tab="login">Sign in</button>' +
        "</div>" +
        (isSignup ? signupForm() : loginForm()) +
        (state.authError ? '<p class="err" style="margin-top:12px">' + esc(state.authError) + "</p>" : "") +
        (isSignup ? "" : credCards()) +
      "</div></div>";
  }

  function credCards() {
    return '<div class="cred-grid">' +
      '<button class="cred-card" data-action="fill" data-email="student@careerpath.com" data-pass="student">' +
        '<span><span class="who-role">Student account</span>' +
        '<span class="who-cred" style="display:block">student@careerpath.com &middot; student</span></span>' +
        '<span class="use">Use</span></button>' +
      '<button class="cred-card" data-action="fill" data-email="admin@careerpath.com" data-pass="admin">' +
        '<span><span class="who-role">Admin account</span>' +
        '<span class="who-cred" style="display:block">admin@careerpath.com &middot; admin</span></span>' +
        '<span class="use">Use</span></button>' +
    "</div>";
  }

  function signupForm() {
    return '<div class="stack" style="gap:12px">' +
      '<div class="field"><label for="su-name">Full name</label><input id="su-name" placeholder="Alex Rivera"></div>' +
      '<div class="field"><label for="su-email">Email</label><input id="su-email" type="email" placeholder="alex@usc.edu"></div>' +
      '<div class="field"><label for="su-pass">Password</label><input id="su-pass" type="password" placeholder="At least 4 characters"></div>' +
      '<div class="auth-grid">' +
        '<div class="field"><label for="su-school">School</label><select id="su-school">' +
          SCHOOLS.map(function (s) { return "<option>" + esc(s) + "</option>"; }).join("") + "</select></div>" +
        '<div class="field"><label for="su-year">Graduation</label><select id="su-year">' +
          ["2026", "2027", "2028", "2029"].map(function (y) { return "<option>" + y + "</option>"; }).join("") + "</select></div>" +
      "</div>" +
      '<div class="field"><label for="su-major">Major</label><select id="su-major">' +
        MAJORS.map(function (m) { return "<option>" + esc(m) + "</option>"; }).join("") + "</select></div>" +
      '<button class="btn primary" style="margin-top:6px;justify-content:center" data-action="signup">Create student account</button>' +
      '<p class="tiny muted">Sign-up creates a student account. Admin accounts are provisioned by the platform team.</p>' +
    "</div>";
  }

  function loginForm() {
    return '<div class="stack" style="gap:12px">' +
      '<div class="field"><label for="li-email">Email</label><input id="li-email" type="email" value="student@careerpath.com"></div>' +
      '<div class="field"><label for="li-pass">Password</label><input id="li-pass" type="password" value="student"></div>' +
      '<button class="btn primary" style="margin-top:6px;justify-content:center" data-action="login">Sign in</button>' +
    "</div>";
  }

  /* ---------------- shell ---------------- */

  var STUDENT_NAV = [
    { id: "roadmap", label: "Roadmap" },
    { id: "leaderboard", label: "Leaderboard" },
    { id: "certs", label: "Certificates" },
    { id: "history", label: "History" }
  ];
  var ADMIN_NAV = [
    { id: "a-content", label: "Content" },
    { id: "a-drafts", label: "Review queue" },
    { id: "a-students", label: "Students" }
  ];

  function navFor(user) {
    if (user.role === "admin") {
      return ADMIN_NAV.map(function (n) {
        return { id: n.id, label: n.label, count: n.id === "a-drafts" ? String(allDrafts().length) : "" };
      });
    }
    return STUDENT_NAV.map(function (n) {
      var count = "";
      if (n.id === "certs") count = String(certsFor(user).length);
      if (n.id === "roadmap" && user.roleId) count = verifiedCount(user) + "/" + role(user.roleId).skills.length;
      return { id: n.id, label: n.label, count: count };
    });
  }

  function activeNav() {
    var n = state.route.name;
    if (state.preview) return "a-content";
    if (["skill", "learn", "assess", "result", "roles"].indexOf(n) > -1) return "roadmap";
    if (n === "cert") return "certs";
    if (n === "a-bank" || n === "a-lessons") return "a-content";
    if (n === "a-student") return "a-students";
    if (n === "a-review") return "a-drafts";
    return n;
  }

  function renderShell(user) {
    document.getElementById("auth").hidden = true;
    document.getElementById("shell").hidden = false;
    var r = role(user.roleId);
    var act = activeNav();
    var admin = user.role === "admin";
    var context = admin ? "Content admin" : (r ? r.name : "No role yet");
    var sub = admin
      ? esc(user.title)
      : user.points + " pts &middot; " + totalStars(user) + STAR;

    document.getElementById("sidebar").innerHTML =
      '<div class="brand"><div class="brand-mark">CP</div><div class="brand-name">CareerPath</div></div>' +
      '<nav class="side">' +
        '<div class="nav-label">' + context + "</div>" +
        navFor(user).map(function (n) {
          return '<button class="nav-item" data-action="nav" data-nav="' + n.id + '" aria-current="' + (act === n.id) + '">' +
            "<span>" + n.label + '</span><span class="nav-count mono">' + n.count + "</span></button>";
        }).join("") +
      "</nav>" +
      '<div class="side-foot"><hr class="divider">' +
        '<div class="who"><div class="avatar">' + esc(initials(user.name)) + "</div><div>" +
          '<div class="who-name">' + esc(user.name) + "</div>" +
          '<div class="who-sub mono">' + sub + "</div>" +
        "</div></div>" +
        '<div class="row" style="gap:6px">' +
          '<button class="btn sm ghost" data-action="nav" data-nav="profile">Profile</button>' +
          '<button class="btn sm ghost" data-action="theme">Theme</button>' +
          '<button class="btn sm ghost" data-action="logout">Sign out</button>' +
        "</div>" +
      "</div>";

    document.getElementById("mobilebar").innerHTML =
      '<div class="mb-top">' +
        '<div class="brand"><div class="brand-mark">CP</div><div class="brand-name">CareerPath</div></div>' +
        '<div class="row" style="gap:4px">' +
          '<span class="pill mono">' + (admin ? "Admin" : user.points + " pts") + "</span>" +
          '<button class="btn sm ghost" data-action="theme">Theme</button>' +
          '<button class="btn sm ghost" data-action="logout">Out</button>' +
        "</div>" +
      "</div>" +
      '<div class="mb-nav">' +
        navFor(user).map(function (n) {
          return '<button data-action="nav" data-nav="' + n.id + '" aria-current="' + (act === n.id) + '">' + n.label + "</button>";
        }).join("") +
        '<button data-action="nav" data-nav="profile" aria-current="' + (act === "profile") + '">Profile</button>' +
      "</div>";
  }

  /* ---------------- student views ---------------- */

  function viewRoles(user) {
    return '<div class="page-head"><div class="eyebrow">Step 1</div><h1>Choose your target role</h1>' +
        '<p class="sub">Each role has its own roadmap, its own courses, and its own assessments. The same skill is taught and tested differently depending on the role you are preparing for.</p></div>' +
      '<div class="role-grid">' +
        ROLES.map(function (r) {
          return '<button class="role-card" data-action="pick-role" data-role="' + r.id + '">' +
            "<h3>" + esc(r.name) + "</h3><p class=\"tag\">" + esc(r.tagline) + "</p>" +
            '<div class="n">' + r.skills.length + " skills &middot; " +
              r.skills.reduce(function (a, s) { return a + s.assessment.length; }, 0) + " assessment questions</div></button>";
        }).join("") +
      "</div>" +
      (user.roleId ? '<p class="tiny muted" style="margin-top:16px">Switching roles keeps your stars on your current track. Stars are earned per skill within a role, so they do not transfer between roles.</p>' : "");
  }

  function viewRoadmap(user) {
    var r = role(user.roleId);
    if (!r) return viewRoles(user);
    var pct = Math.round(totalStars(user) / maxStars(user) * 100);

    return '<div class="page-head"><div class="eyebrow">' + esc(r.name) + " roadmap</div>" +
        "<h1>Your verified skill roadmap</h1>" +
        '<p class="sub">Progress moves only through assessment. Nothing here can be checked off by hand.</p></div>' +
      '<div class="summary-row">' +
        summaryCell("Verified skills", verifiedCount(user) + "<small> / " + r.skills.length + "</small>") +
        summaryCell("Stars earned", totalStars(user) + "<small> / " + maxStars(user) + "</small>") +
        summaryCell("Roadmap complete", pct + "<small>%</small>") +
        summaryCell("Leaderboard points", String(user.points)) +
      "</div>" +
      '<div class="bar" style="margin-bottom:22px"><span style="width:' + pct + '%"></span></div>' +
      '<div class="skill-list">' +
        r.skills.map(function (s) {
          var p = prog(user, s.id);
          var status = p.stars === 0 ? '<span class="pill">Not started</span>'
            : '<span class="pill ok">' + LEVELS[p.stars].label + "</span>";
          return '<button class="skill-row" data-action="open-skill" data-skill="' + s.id + '">' +
            '<span><span class="skill-name">' + esc(s.name) + '</span><span class="skill-lens" style="display:block">' + esc(s.lens) + "</span></span>" +
            '<span class="skill-right">' + status + starHTML(p.stars) +
              (p.best ? '<span class="mono tiny muted">' + p.best + "%</span>" : '<span class="mono tiny muted">&mdash;</span>') +
            "</span></button>";
        }).join("") +
      "</div>" +
      '<div class="row" style="margin-top:18px;justify-content:space-between">' +
        '<p class="tiny muted">Stars: ' + STAR + " Foundation &middot; " + STAR + STAR + " Basic application &middot; " +
          STAR + STAR + STAR + " Job-ready &middot; " + STAR + STAR + STAR + STAR + " Advanced &middot; " +
          STAR + STAR + STAR + STAR + STAR + " Practical mastery</p>" +
        (state.preview ? "" : '<button class="btn sm" data-action="nav" data-nav="roles">Change role</button>') +
      "</div>";
  }

  function viewSkill(user) {
    var s = skill(user.roleId, state.route.skill);
    var p = prog(user, s.id);
    var r = role(user.roleId);
    var lessonsDone = p.lessonsDone.length;

    return '<div class="page-head">' +
        (state.preview ? "" : '<button class="btn sm ghost" style="margin-bottom:10px" data-action="nav" data-nav="roadmap">&larr; Roadmap</button>') +
        '<div class="eyebrow">' + esc(r.name) + " track</div><h1>" + esc(s.name) + "</h1>" +
        '<p class="sub">' + esc(s.summary) + "</p></div>" +

      '<div class="card" style="margin-bottom:18px">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start">' +
          "<div><div class=\"eyebrow\">Current level</div>" +
            '<div style="font-size:19px;margin:4px 0 2px">' + starHTML(p.stars, "19px") +
              ' <span style="font-weight:500">' + LEVELS[p.stars].label + "</span></div>" +
            '<p class="tiny muted">' + (p.attempts ? "Best score " + p.best + "% over " + p.attempts + " attempt" + (p.attempts > 1 ? "s" : "") : "No assessment taken yet") + "</p></div>" +
          '<div class="row" style="gap:8px">' +
            '<button class="btn" data-action="start-learn" data-skill="' + s.id + '">' + (lessonsDone ? "Continue course" : "Learn the skill") + "</button>" +
            '<button class="btn primary" data-action="start-exam" data-skill="' + s.id + '">Take the assessment</button>' +
          "</div></div></div>" +

      '<div class="stack">' +
        '<div class="card">' +
          '<div class="row" style="justify-content:space-between;margin-bottom:10px">' +
            '<h3 style="font-size:15px">Course modules</h3><span class="pill">' + lessonsDone + " / " + s.lessons.length + " read</span></div>" +
          '<div class="stack" style="gap:8px">' +
            s.lessons.map(function (l, i) {
              var done = p.lessonsDone.indexOf(i) > -1;
              return '<button class="opt" data-action="start-learn" data-skill="' + s.id + '" data-lesson="' + i + '">' +
                '<span class="key">' + (done ? "&#10003;" : i + 1) + "</span><span>" + esc(l.title) + "</span></button>";
            }).join("") +
          "</div></div>" +

        '<div class="card"><h3 style="font-size:15px;margin-bottom:6px">Practical project</h3>' +
          '<p class="tiny muted" style="margin-bottom:10px"><b style="color:var(--ink)">' + esc(s.project.title) + "</b> &mdash; " + esc(s.project.brief) + "</p>" +
          (p.project ? '<span class="pill ok">Submitted &middot; +150 points</span>'
            : '<div class="row"><button class="btn sm" data-action="submit-project" data-skill="' + s.id + '">Mark project submitted</button>' +
              '<span class="tiny muted">Required for the fifth star.</span></div>') +
        "</div>" +

        '<div class="card"><h3 style="font-size:15px;margin-bottom:10px">Assessment</h3>' +
          '<div class="row" style="gap:16px">' +
            '<span class="tiny muted"><b class="mono" style="color:var(--ink)">' + s.assessment.length + "</b> questions</span>" +
            '<span class="tiny muted">Difficulty <b class="mono" style="color:var(--ink)">L1&ndash;L5</b></span>' +
            '<span class="tiny muted">Scored on first selection per question</span>' +
          "</div></div>" +
      "</div>";
  }

  function viewLearn(user) {
    var s = skill(user.roleId, state.route.skill);
    var p = prog(user, s.id);
    var i = Math.min(state.lessonIdx, s.lessons.length - 1);
    var lesson = s.lessons[i];
    var last = i === s.lessons.length - 1;

    return '<div class="page-head">' +
        '<button class="btn sm ghost" style="margin-bottom:10px" data-action="open-skill" data-skill="' + s.id + '">&larr; ' + esc(s.name) + "</button>" +
        '<div class="eyebrow">Module ' + (i + 1) + " of " + s.lessons.length + "</div><h1>" + esc(lesson.title) + "</h1></div>" +
      '<div class="lesson-nav">' +
        s.lessons.map(function (l, j) {
          var done = p.lessonsDone.indexOf(j) > -1;
          return '<button data-action="lesson" data-i="' + j + '" aria-current="' + (j === i) + '" class="' + (done && j !== i ? "done" : "") + '">' + (j + 1) + ". " + esc(l.title) + "</button>";
        }).join("") +
      "</div>" +
      '<div class="card prose" style="margin-bottom:18px">' + paras(lesson.body) + "</div>" +
      (last ? practiceBlock(s) + quizBlock(s) : "") +
      '<div class="row" style="margin-top:20px;justify-content:space-between">' +
        '<button class="btn" data-action="lesson" data-i="' + Math.max(0, i - 1) + '"' + (i === 0 ? " disabled" : "") + ">&larr; Previous</button>" +
        (last ? '<button class="btn primary" data-action="start-exam" data-skill="' + s.id + '">Go to assessment &rarr;</button>'
              : '<button class="btn primary" data-action="lesson" data-i="' + (i + 1) + '">Next module &rarr;</button>') +
      "</div>";
  }

  var KIND = {
    query: { label: "Write a query", placeholder: "-- Write your query here" },
    formula: { label: "Write the formula", placeholder: "=" },
    written: { label: "Written answer", placeholder: "Write your answer here before taking a hint" }
  };

  function pstate(key) {
    if (!state.practiceState[key]) state.practiceState[key] = { hints: 0, shown: false, text: "", checked: null, tries: 0 };
    return state.practiceState[key];
  }

  /* Structural check. There is no database in the browser, so a query is checked
     against what a correct answer must contain and the mistakes that make one wrong.
     Written answers are checked for concept coverage instead of correctness. */
  function runCheck(ex, text) {
    var t = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!t) return { empty: true };
    var c = ex.check;
    if (!c) return { none: true };

    var graded = !c.points.length;
    var criteria = (graded ? c.must : c.points).map(function (m) {
      return { label: m.label, ok: m.re.test(t) };
    });
    var problems = c.forbid.filter(function (m) { return m.re.test(t); })
      .map(function (m) { return m.label; });

    var met = criteria.filter(function (x) { return x.ok; }).length;
    var verdict;
    if (graded) {
      verdict = (met === criteria.length && !problems.length) ? "correct"
              : (!problems.length && met / criteria.length >= 0.6) ? "close" : "not-yet";
    } else {
      verdict = met === criteria.length ? "full" : met ? "partial" : "none-covered";
    }
    return { criteria: criteria, problems: problems, met: met, total: criteria.length, graded: graded, verdict: verdict };
  }

  var VERDICT = {
    correct: { tone: "ok", title: "Looks correct" },
    close: { tone: "warn", title: "Close, but something is missing" },
    "not-yet": { tone: "bad", title: "Not yet" },
    full: { tone: "ok", title: "Covers every key point" },
    partial: { tone: "warn", title: "Partly covered" },
    "none-covered": { tone: "bad", title: "None of the key points yet" }
  };

  function checkPanel(res) {
    if (res.empty) {
      return '<div class="check-panel bad"><b>Write an attempt first.</b>' +
        '<p class="tiny" style="margin-top:4px">The check looks at what you wrote, so there is nothing to check yet.</p></div>';
    }
    if (res.none) {
      return '<div class="check-panel warn"><b>No automatic check for this exercise.</b>' +
        '<p class="tiny" style="margin-top:4px">Compare your answer against the model answer below.</p></div>';
    }
    var v = VERDICT[res.verdict];
    return '<div class="check-panel ' + v.tone + '">' +
      '<div class="row" style="justify-content:space-between;gap:10px">' +
        "<b>" + v.title + "</b>" +
        '<span class="mono tiny">' + res.met + " / " + res.total + (res.graded ? " requirements" : " key points") + "</span>" +
      "</div>" +
      '<ul class="crits">' +
        res.criteria.map(function (c) {
          return '<li class="crit ' + (c.ok ? "met" : "unmet") + '"><span class="mark">' +
            (c.ok ? "&#10003;" : "&#8213;") + "</span><span>" + esc(c.label) + "</span></li>";
        }).join("") +
        res.problems.map(function (p) {
          return '<li class="crit problem"><span class="mark">&#10007;</span><span>' + esc(p) + "</span></li>";
        }).join("") +
      "</ul>" +
      '<p class="tiny check-note">' + (res.graded
        ? "This checks the structure of your query against what a correct answer has to contain. It does not run the query against data, so it can pass something that would still fail on a real table."
        : "This checks whether you raised each idea, not how well you argued it. Read the model answer to judge the reasoning.") + "</p>" +
    "</div>";
  }

  function practiceBlock(s) {
    return '<div class="card" style="margin-bottom:18px">' +
      '<h3 style="font-size:15px;margin-bottom:4px">Practice exercises</h3>' +
      '<p class="tiny muted" style="margin-bottom:14px">Write your own answer, check it, and take a hint if you are stuck. Practice is for learning only and never affects your stars.</p>' +
      '<div class="stack" style="gap:14px">' +
      s.practice.map(function (ex, i) {
        var key = s.id + "-" + i;
        var st = pstate(key);
        var kind = KIND[ex.kind || "written"];
        var hints = ex.hints || [];
        var more = hints.length - st.hints;

        return '<div class="ex">' +
          '<div class="row" style="justify-content:space-between;margin-bottom:9px">' +
            '<span class="pill accent">Exercise ' + (i + 1) + "</span>" +
            '<span class="pill">' + kind.label + "</span>" +
          "</div>" +

          '<p class="ex-prompt">' + esc(ex.prompt) + "</p>" +

          (ex.schema
            ? '<div class="ex-schema"><span class="fl">Tables available</span><pre>' + esc(ex.schema) + "</pre></div>"
            : "") +

          '<textarea class="ex-input' + (ex.kind === "query" || ex.kind === "formula" ? " code" : "") +
            '" data-practice="' + key + '" rows="' + (ex.kind === "query" ? 8 : 4) +
            '" placeholder="' + esc(kind.placeholder) + '" spellcheck="false">' + esc(st.text) + "</textarea>" +

          '<div class="row" style="margin-top:10px">' +
            '<button class="btn sm primary" data-action="practice-check" data-key="' + key + '">' +
              (st.checked ? "Check again" : "Check my answer") + "</button>" +
            (more > 0
              ? '<button class="btn sm" data-action="practice-hint" data-key="' + key + '">' +
                (st.hints === 0 ? "Show a hint" : "Next hint") + " (" + more + " left)</button>"
              : (hints.length ? '<span class="tiny muted">All hints shown</span>' : "")) +
            '<button class="btn sm" data-action="practice-answer" data-key="' + key + '">' +
              (st.shown ? "Hide answer" : "Show answer") + "</button>" +
            (st.tries > 1 ? '<span class="tiny muted mono">attempt ' + st.tries + "</span>" : "") +
          "</div>" +

          (st.checked ? checkPanel(st.checked) : "") +

          (st.hints > 0
            ? '<div class="stack" style="gap:7px;margin-top:11px">' +
              hints.slice(0, st.hints).map(function (h, j) {
                return '<div class="hint"><b>Hint ' + (j + 1) + "</b> " + esc(h) + "</div>";
              }).join("") + "</div>"
            : "") +

          (st.shown
            ? '<div style="margin-top:12px">' +
              (ex.solution ? '<div class="ex-solution"><span class="fl">Model answer</span><pre>' + esc(ex.solution) + "</pre></div>" : "") +
              '<div class="why">' + esc(ex.answer).split("\n\n").map(function (p) { return "<p>" + p + "</p>"; }).join("") + "</div>" +
            "</div>"
            : "") +
        "</div>";
      }).join("") + "</div></div>";
  }

  function quizBlock(s) {
    var q = state.quiz;
    if (!q || q.skillId !== s.id) {
      return '<div class="card"><h3 style="font-size:15px;margin-bottom:4px">Module quiz</h3>' +
        '<p class="tiny muted" style="margin-bottom:12px">' + s.quiz.length + " questions. Checks the module before you attempt the graded assessment.</p>" +
        '<button class="btn" data-action="start-quiz" data-skill="' + s.id + '">Start module quiz</button></div>';
    }
    if (q.done) {
      var right = q.answers.filter(function (a, i) { return a === s.quiz[i].a; }).length;
      return '<div class="card"><h3 style="font-size:15px;margin-bottom:10px">Module quiz &mdash; ' + right + " of " + s.quiz.length + " correct</h3>" +
        '<div class="stack" style="gap:14px">' +
          s.quiz.map(function (item, i) {
            return "<div><p style=\"font-weight:500;margin-bottom:8px\">" + (i + 1) + ". " + esc(item.q) + "</p>" +
              '<div class="opts">' + item.opts.map(function (o, j) {
                var st = j === item.a ? "correct" : (q.answers[i] === j ? "wrong" : "");
                return '<div class="opt" data-state="' + st + '"><span class="key">' + "ABCD"[j] + "</span><span>" + esc(o) + "</span></div>";
              }).join("") + '</div><div class="why"><b>Why:</b> ' + esc(item.why) + "</div></div>";
          }).join("") +
        '</div><button class="btn sm" style="margin-top:14px" data-action="start-quiz" data-skill="' + s.id + '">Retake quiz</button></div>';
    }
    var item = s.quiz[q.idx];
    return '<div class="card"><div class="progress-head"><span>Module quiz &middot; question ' + (q.idx + 1) + " of " + s.quiz.length + "</span></div>" +
      '<p class="q-stem">' + esc(item.q) + '</p><div class="opts">' +
      item.opts.map(function (o, j) {
        return '<button class="opt" data-action="quiz-answer" data-i="' + j + '"><span class="key">' + "ABCD"[j] + "</span><span>" + esc(o) + "</span></button>";
      }).join("") + "</div></div>";
  }

  function viewExam(user) {
    var s = skill(user.roleId, state.route.skill);
    var e = state.exam;
    var item = s.assessment[e.idx];
    var pctDone = Math.round(e.idx / s.assessment.length * 100);

    return '<div class="page-head"><div class="eyebrow">Assessment &middot; ' + esc(s.name) + "</div>" +
        "<h1>Question " + (e.idx + 1) + " of " + s.assessment.length + "</h1></div>" +
      '<div class="bar" style="margin-bottom:18px"><span style="width:' + pctDone + '%"></span></div>' +
      '<div class="q-card"><div class="progress-head">' +
        '<span class="pill">Level ' + item.lvl + '</span><span class="tiny muted ver">' + esc(item.qid) + " v" + item.v + "</span></div>" +
        '<p class="q-stem">' + esc(item.q) + '</p><div class="opts">' +
        item.opts.map(function (o, j) {
          return '<button class="opt" data-action="exam-answer" data-i="' + j + '"><span class="key">' + "ABCD"[j] + "</span><span>" + esc(o) + "</span></button>";
        }).join("") + "</div></div>" +
      '<p class="tiny muted" style="margin-top:14px">Answers are final once selected. Each attempt records the question version it was scored against.</p>';
  }

  function viewResult(user) {
    var res = state.result;
    var s = skill(user.roleId, res.skillId);
    var p = prog(user, res.skillId);
    var byLevel = {};
    s.assessment.forEach(function (q, i) {
      var k = "L" + q.lvl;
      if (!byLevel[k]) byLevel[k] = { right: 0, total: 0 };
      byLevel[k].total++;
      if (res.answers[i] === q.a) byLevel[k].right++;
    });
    var weak = s.assessment.filter(function (q, i) { return res.answers[i] !== q.a; });

    return '<div class="page-head"><div class="eyebrow">Result &middot; ' + esc(s.name) + "</div>" +
        "<h1>" + res.pct + "% &mdash; " + res.award.label + "</h1>" +
        '<p class="sub">' + (state.preview
            ? "Preview only. No score, stars, or points were recorded for anyone."
            : (res.newStars ? "Your roadmap has been updated and " + res.pointsAwarded + " leaderboard points were added."
                            : "This did not beat your previous best of " + p.best + "%, so your roadmap is unchanged.")) + "</p></div>" +

      '<div class="card" style="margin-bottom:18px;text-align:center">' +
        '<div style="font-size:30px;line-height:1">' + starHTML(res.award.stars, "30px") + "</div>" +
        '<p style="margin-top:8px;font-weight:500">' + res.award.label + "</p>" +
        (res.award.capped ? '<p class="tiny" style="color:var(--warn);margin-top:6px">Scored at mastery level. The fifth star unlocks when the practical project is submitted.</p>' : "") +
      "</div>" +

      '<div class="summary-row">' +
        summaryCell("Score", res.right + "<small> / " + s.assessment.length + "</small>") +
        summaryCell("Percent", res.pct + "<small>%</small>") +
        summaryCell("Stars", res.award.stars + "<small> / 5</small>") +
        summaryCell("Attempt", String(p.attempts)) +
      "</div>" +

      '<div class="stack"><div class="card">' +
          '<h3 style="font-size:15px;margin-bottom:12px">Performance by difficulty</h3>' +
          '<div class="scroll-x"><table class="grid"><thead><tr><th>Level</th><th>Correct</th><th>Result</th></tr></thead><tbody>' +
            Object.keys(byLevel).sort().map(function (k) {
              var b = byLevel[k];
              return '<tr><td class="mono">' + k + '</td><td class="mono">' + b.right + " / " + b.total + "</td><td>" +
                (b.right === b.total ? '<span class="pill ok">Strong</span>' : b.right === 0 ? '<span class="pill bad">Weak</span>' : '<span class="pill warn">Partial</span>') +
                "</td></tr>";
            }).join("") + "</tbody></table></div></div>" +

        (weak.length ? '<div class="card"><h3 style="font-size:15px;margin-bottom:4px">Review these ' + weak.length + "</h3>" +
          '<p class="tiny muted" style="margin-bottom:13px">Each one you missed, with the reasoning.</p>' +
          '<div class="stack" style="gap:16px">' +
            s.assessment.map(function (q, i) {
              if (res.answers[i] === q.a) return "";
              return '<div><p style="font-weight:500;margin-bottom:8px"><span class="pill" style="margin-right:6px">L' + q.lvl + "</span>" + esc(q.q) + "</p>" +
                '<div class="opts">' + q.opts.map(function (o, j) {
                  var st = j === q.a ? "correct" : (res.answers[i] === j ? "wrong" : "");
                  return '<div class="opt" data-state="' + st + '"><span class="key">' + "ABCD"[j] + "</span><span>" + esc(o) + "</span></div>";
                }).join("") + '</div><div class="why"><b>Why:</b> ' + esc(q.why) + "</div>" +
                '<div class="row" style="margin-top:9px"><button class="tutor-inline" data-action="tutor-explain" data-i="' + i + '">Ask the assistant why</button></div>' +
                "</div>";
            }).join("") + "</div></div>"
          : '<div class="card"><h3 style="font-size:15px">Every question correct.</h3><p class="tiny muted" style="margin-top:5px">Nothing to review on this attempt.</p></div>') +
      "</div>" +

      '<div class="row" style="margin-top:20px">' +
        (state.preview
          ? '<button class="btn primary" data-action="exit-preview">Exit preview</button>'
          : '<button class="btn primary" data-action="nav" data-nav="roadmap">Back to roadmap</button>') +
        '<button class="btn" data-action="start-exam" data-skill="' + s.id + '">Retake assessment</button>' +
        (!state.preview && prog(user, s.id).stars >= 3 ? '<button class="btn" data-action="open-cert" data-skill="' + s.id + '">View certificate</button>' : "") +
      "</div>";
  }

  function viewCerts(user) {
    var list = certsFor(user);
    var r = role(user.roleId);
    return '<div class="page-head"><div class="eyebrow">Certificates</div><h1>Verified proficiency</h1>' +
        '<p class="sub">A certificate is issued at three stars or above, which is the job-ready threshold. Each one names the role track, because the same skill is assessed differently in each.</p></div>' +
      (list.length === 0
        ? '<div class="card"><p class="muted">No certificates yet. Reach ' + STAR + STAR + STAR + " on any skill in the " + esc(r.name) + " roadmap to issue one.</p>" +
          '<button class="btn sm primary" style="margin-top:12px" data-action="nav" data-nav="roadmap">Open roadmap</button></div>'
        : '<div class="skill-list">' + list.map(function (c) {
            return '<button class="skill-row" data-action="open-cert" data-skill="' + c.skill.id + '">' +
              '<span><span class="skill-name">' + esc(c.skill.name) + '</span><span class="skill-lens" style="display:block">' +
                LEVELS[c.p.stars].label + " &middot; " + verifyId(user, c.skill.id) + "</span></span>" +
              '<span class="skill-right">' + starHTML(c.p.stars) + '<span class="pill accent">View</span></span></button>';
          }).join("") + "</div>");
  }

  function viewCert(user) {
    var s = skill(user.roleId, state.route.skill);
    var p = prog(user, s.id);
    var r = role(user.roleId);
    return '<div class="page-head"><button class="btn sm ghost" style="margin-bottom:10px" data-action="nav" data-nav="certs">&larr; Certificates</button><h1>Certificate</h1></div>' +
      '<div class="cert"><div class="cert-org">CareerPath &middot; Verified Skill Certificate</div>' +
        '<div class="cert-name">' + esc(user.name) + '</div><div class="cert-skill">' + esc(s.name) + "</div>" +
        '<div class="cert-level"><div style="font-size:24px">' + starHTML(p.stars, "24px") + "</div>" +
          '<div style="font-weight:500;margin-top:5px">' + LEVELS[p.stars].label + "</div></div>" +
        '<p class="tiny muted" style="max-width:52ch;margin:0 auto">Demonstrated through assessment on the ' + esc(r.name) +
          " track. Progress on this platform is earned only through scored assessment.</p>" +
        '<div class="cert-meta"><span>ID ' + verifyId(user, s.id) + "</span><span>Score " + p.best + "%</span>" +
          "<span>" + esc(user.school) + "</span><span>Issued " + today() + "</span></div></div>" +
      '<p class="tiny muted" style="margin-top:14px">In the working product this is a downloadable PDF and the ID resolves to a public verification page.</p>';
  }

  function viewLeaderboard(user) {
    var r = role(user.roleId);
    var peers = state.users.filter(function (u) {
      return u.role === "student" && u.school === user.school && u.roleId === user.roleId;
    }).sort(function (a, b) { return b.points - a.points || totalStars(b) - totalStars(a); });

    return '<div class="page-head"><div class="eyebrow">' + esc(user.school) + " &middot; " + esc(r.name) + "</div>" +
        "<h1>School leaderboard</h1>" +
        '<p class="sub">You compete only with students at your own school who chose the same target role. Points come from reaching new verified levels and completing practical projects, so repeating an assessment you have already passed adds nothing.</p></div>' +
      '<div class="card" style="padding:14px 16px"><div class="scroll-x"><table class="grid">' +
        "<thead><tr><th></th><th>Student</th><th>Stars</th><th>Verified skills</th><th>Points</th></tr></thead><tbody>" +
        peers.map(function (u, i) {
          return '<tr class="' + (u.id === user.id ? "lb-you" : "") + '">' +
            '<td><span class="rank ' + (i < 3 ? "top" : "") + '">' + (i + 1) + "</span></td>" +
            "<td>" + esc(u.name) + (u.id === user.id ? ' <span class="pill accent">You</span>' : "") + "</td>" +
            "<td>" + starHTML(Math.round(totalStars(u) / Math.max(1, role(u.roleId).skills.length))) +
              ' <span class="mono tiny muted">' + totalStars(u) + "</span></td>" +
            '<td class="mono">' + verifiedCount(u) + " / " + role(u.roleId).skills.length + "</td>" +
            '<td class="mono">' + u.points + "</td></tr>";
        }).join("") + "</tbody></table></div></div>" +
      '<p class="tiny muted" style="margin-top:14px">Other roles at ' + esc(user.school) + " have separate boards. Star column shows the average level across the roadmap, with total stars beside it.</p>";
  }

  function viewHistory(user) {
    var r = role(user.roleId);
    var rows = [];
    r.skills.forEach(function (s) {
      var hist = prog(user, s.id).history;
      var best = hist.reduce(function (a, h) { return Math.max(a, h.pct); }, -1);
      var bestSeen = false;
      hist.forEach(function (h, i) {
        var isBest = !bestSeen && h.pct === best;
        if (isBest) bestSeen = true;
        rows.push({ s: s, h: h, n: i + 1, of: hist.length, isBest: isBest });
      });
    });
    rows.reverse();
    return '<div class="page-head"><div class="eyebrow">Activity</div><h1>Assessment history</h1>' +
      '<p class="sub">One row per scored attempt on the ' + esc(r.name) +
        " track. A skill that appears more than once is the same assessment retaken, not a different track, and only the best attempt sets your stars.</p></div>" +
      (rows.length === 0 ? '<div class="card"><p class="muted">No attempts yet.</p></div>'
        : '<div class="card" style="padding:14px 16px"><div class="scroll-x"><table class="grid">' +
          "<thead><tr><th>When</th><th>Skill</th><th>Attempt</th><th>Score</th><th>Level awarded</th></tr></thead><tbody>" +
          rows.map(function (row) {
            return '<tr><td class="mono tiny">' + esc(row.h.when) + "</td><td>" + esc(row.s.name) + "</td>" +
              '<td class="mono tiny">' + row.n + " of " + row.of +
                (row.isBest && row.of > 1 ? ' <span class="pill ok">Counts</span>' : "") + "</td>" +
              '<td class="mono">' + row.h.pct + "%</td><td>" + starHTML(row.h.stars) +
              ' <span class="tiny muted">' + LEVELS[row.h.stars].label + "</span></td></tr>";
          }).join("") + "</tbody></table></div></div>");
  }

  function viewProfile(user) {
    if (user.role === "admin") {
      return '<div class="page-head"><div class="eyebrow">Account</div><h1>' + esc(user.name) + "</h1>" +
        '<p class="sub">' + esc(user.title) + " &middot; CareerPath platform team</p></div>" +
        '<div class="summary-row">' +
          summaryCell("Access", '<span style="font-size:15px;font-family:var(--sans)">Content admin</span>') +
          summaryCell("Skills managed", String(allSkills().length)) +
          summaryCell("Drafts pending", String(allDrafts().length)) +
          summaryCell("Students", String(state.users.filter(function (u) { return u.role === "student"; }).length)) +
        "</div>" +
        '<div class="card"><h3 style="font-size:15px;margin-bottom:8px">What this account can do</h3>' +
        '<p class="tiny muted">Edit lessons and publish them directly. Propose question changes as drafts, which require a publish step and retain the previous version. Preview any content exactly as a student sees it. This account has no roadmap, takes no assessments, and does not appear on any leaderboard.</p></div>';
    }
    var r = role(user.roleId);
    return '<div class="page-head"><div class="eyebrow">Account</div><h1>' + esc(user.name) + "</h1>" +
      '<p class="sub">' + esc(user.major) + " &middot; " + esc(user.school) + " &middot; Class of " + esc(user.gradYear) + "</p></div>" +
      '<div class="summary-row">' +
        summaryCell("Target role", '<span style="font-size:15px;font-family:var(--sans)">' + esc(r ? r.name : "None") + "</span>") +
        summaryCell("Stars", totalStars(user) + "<small> / " + maxStars(user) + "</small>") +
        summaryCell("Certificates", String(certsFor(user).length)) +
        summaryCell("Points", String(user.points)) +
      "</div>" +
      '<div class="card"><h3 style="font-size:15px;margin-bottom:8px">Target role</h3>' +
        '<p class="tiny muted" style="margin-bottom:12px">Changing role gives you a different roadmap. Stars stay attached to the role they were earned in, because the assessments differ.</p>' +
        '<button class="btn" data-action="nav" data-nav="roles">Change target role</button></div>';
  }

  /* ---------------- admin views ---------------- */

  function viewAdminContent() {
    var qTotal = allSkills().reduce(function (a, x) { return a + x.skill.assessment.length; }, 0);
    var lTotal = allSkills().reduce(function (a, x) { return a + x.skill.lessons.length; }, 0);

    return '<div class="page-head"><div class="eyebrow">Content</div><h1>Roadmaps and course material</h1>' +
      '<p class="sub">Lessons publish directly. Assessment questions go through a draft and publish step, because scores and certificates are tied to the version that was live when the student took the exam.</p></div>' +
      '<div class="summary-row">' +
        summaryCell("Roles", String(ROLES.length)) +
        summaryCell("Skills", String(allSkills().length)) +
        summaryCell("Lessons", String(lTotal)) +
        summaryCell("Live questions", String(qTotal)) +
      "</div>" +
      '<div class="card" style="padding:14px 16px"><div class="scroll-x"><table class="grid">' +
        "<thead><tr><th>Role</th><th>Skill</th><th>Lessons</th><th>Questions</th><th>Drafts</th><th></th></tr></thead><tbody>" +
        allSkills().map(function (x) {
          var d = x.skill.drafts.length;
          return "<tr><td>" + esc(x.role.name) + "</td><td>" + esc(x.skill.name) + "</td>" +
            '<td class="mono">' + x.skill.lessons.length + '</td><td class="mono">' + x.skill.assessment.length + "</td>" +
            "<td>" + (d ? '<span class="pill warn">' + d + "</span>" : '<span class="mono muted">0</span>') + "</td>" +
            '<td><div class="row" style="gap:6px;flex-wrap:nowrap">' +
              '<button class="btn sm" data-action="a-open" data-role="' + x.role.id + '" data-skill="' + x.skill.id + '">Questions</button>' +
              '<button class="btn sm" data-action="a-lessons" data-role="' + x.role.id + '" data-skill="' + x.skill.id + '">Lessons</button>' +
            "</div></td></tr>";
        }).join("") + "</tbody></table></div></div>";
  }

  function viewAdminBank() {
    var ctx = state.adminSkill;
    var s = skill(ctx.roleId, ctx.skillId);
    var r = role(ctx.roleId);

    return '<div class="page-head">' +
        '<button class="btn sm ghost" style="margin-bottom:10px" data-action="nav" data-nav="a-content">&larr; Content</button>' +
        '<div class="eyebrow">' + esc(r.name) + " &middot; question bank</div><h1>" + esc(s.name) + "</h1>" +
        '<p class="sub">' + s.assessment.length + " live questions, " + s.drafts.length + " draft" +
          (s.drafts.length === 1 ? "" : "s") + " awaiting publish, " + s.archive.length + " archived version" +
          (s.archive.length === 1 ? "" : "s") + ".</p></div>" +

      '<div class="row" style="margin-bottom:16px">' +
        '<button class="btn primary sm" data-action="a-new">Add question</button>' +
        '<button class="btn sm" data-action="preview" data-mode="assess">Preview assessment as student</button>' +
        '<button class="btn sm" data-action="preview" data-mode="learn">Preview course as student</button>' +
      "</div>" +

      (state.adminEdit === "new" ? editorCard(null, s) : "") +

      '<div class="stack" style="gap:10px">' +
        s.assessment.map(function (q) {
          if (state.adminEdit === q.qid) return editorCard(q, s);
          var d = draftFor(s, q.qid);
          var arch = archiveFor(s, q.qid);
          return '<div style="border:1px solid ' + (d ? "var(--warn)" : "var(--line)") + ';border-radius:9px;padding:13px">' +
            '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
              '<p style="font-weight:500;max-width:60ch"><span class="pill" style="margin-right:6px">L' + q.lvl + "</span>" + esc(q.q) + "</p>" +
              '<div class="row" style="gap:6px;flex-wrap:nowrap">' +
                (d ? '<button class="btn sm primary" data-action="a-review-one" data-qid="' + q.qid + '">Review draft</button>'
                   : '<button class="btn sm" data-action="a-edit" data-qid="' + q.qid + '">Edit</button>') +
                '<button class="btn sm" data-action="a-history" data-qid="' + q.qid + '">History</button>' +
                '<button class="btn sm" data-action="a-retire" data-qid="' + q.qid + '">Retire</button>' +
              "</div></div>" +
            '<div class="row" style="gap:14px;margin-top:8px">' +
              '<span class="tiny muted">Correct: <b style="color:var(--ok)">' + esc(q.opts[q.a]) + "</b></span>" +
              '<span class="ver">' + esc(q.qid) + " &middot; v" + q.v + "</span>" +
              (d ? '<span class="pill warn">Draft pending</span>' : "") +
              (arch.length ? '<span class="tiny muted">' + arch.length + " earlier version" + (arch.length === 1 ? "" : "s") + "</span>" : "") +
            "</div>" +
            (state.adminHistory === q.qid ? historyBlock(arch) : "") +
          "</div>";
        }).join("") +
      "</div>";
  }

  function historyBlock(arch) {
    if (!arch.length) return '<p class="tiny muted" style="margin-top:10px">No earlier versions. This question has never been changed.</p>';
    return '<div class="stack" style="gap:8px;margin-top:12px">' +
      arch.slice().reverse().map(function (a) {
        return '<div style="border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--surface-2)">' +
          '<div class="row" style="justify-content:space-between"><span class="ver">v' + a.v + " &middot; retired " + esc(a.retired) + "</span>" +
            (a.retiredOut ? '<span class="pill bad">Removed from bank</span>' : '<span class="pill">Superseded</span>') + "</div>" +
          '<p class="tiny" style="margin-top:6px">' + esc(a.fields.q) + "</p>" +
          '<p class="tiny muted" style="margin-top:4px">Correct: ' + esc(a.fields.opts[a.fields.a]) + "</p></div>";
      }).join("") + "</div>";
  }

  function editorCard(q, s) {
    var f = q ? { q: q.q, opts: q.opts, a: q.a, lvl: q.lvl, why: q.why }
              : { q: "", opts: ["", "", "", ""], a: 0, lvl: 1, why: "" };
    return '<div style="border:1px solid var(--accent);border-radius:9px;padding:15px;margin-bottom:12px">' +
      '<h3 style="font-size:14px;margin-bottom:4px">' + (q ? "Edit question " + esc(q.qid) + " (currently v" + q.v + ")" : "New question") + "</h3>" +
      '<p class="tiny muted" style="margin-bottom:13px">' + (q
        ? "Saving creates a draft. The live question stays at v" + q.v + " until the draft is published."
        : "Saving creates a draft. The question goes live once the draft is published.") + "</p>" +
      '<div class="stack" style="gap:10px">' +
        '<div class="field"><label for="ae-q">Question</label><input id="ae-q" value="' + esc(f.q) + '"></div>' +
        [0, 1, 2, 3].map(function (j) {
          return '<div class="field"><label for="ae-o' + j + '">Option ' + "ABCD"[j] + '</label><input id="ae-o' + j + '" value="' + esc(f.opts[j] || "") + '"></div>';
        }).join("") +
        '<div class="auth-grid">' +
          '<div class="field"><label for="ae-a">Correct answer</label><select id="ae-a">' +
            [0, 1, 2, 3].map(function (j) { return '<option value="' + j + '"' + (j === f.a ? " selected" : "") + ">" + "ABCD"[j] + "</option>"; }).join("") + "</select></div>" +
          '<div class="field"><label for="ae-l">Difficulty level</label><select id="ae-l">' +
            [1, 2, 3, 4, 5].map(function (l) { return '<option value="' + l + '"' + (l === f.lvl ? " selected" : "") + ">L" + l + "</option>"; }).join("") + "</select></div>" +
        "</div>" +
        '<div class="field"><label for="ae-w">Explanation shown after the assessment</label><input id="ae-w" value="' + esc(f.why) + '"></div>' +
        '<div class="row"><button class="btn primary sm" data-action="a-save" data-qid="' + (q ? q.qid : "new") + '">Save as draft</button>' +
          '<button class="btn sm" data-action="a-cancel">Cancel</button></div>' +
      "</div></div>";
  }

  function viewAdminLessons() {
    var ctx = state.adminSkill;
    var s = skill(ctx.roleId, ctx.skillId);
    var r = role(ctx.roleId);
    var ed = state.adminLesson;

    return '<div class="page-head">' +
        '<button class="btn sm ghost" style="margin-bottom:10px" data-action="nav" data-nav="a-content">&larr; Content</button>' +
        '<div class="eyebrow">' + esc(r.name) + " &middot; course material</div><h1>" + esc(s.name) + "</h1>" +
        '<p class="sub">Lesson edits publish immediately. They carry no scoring risk, so they do not need a review step.</p></div>' +
      '<div class="row" style="margin-bottom:16px">' +
        '<button class="btn sm" data-action="preview" data-mode="learn">Preview course as student</button></div>' +
      '<div class="stack" style="gap:10px">' +
        s.lessons.map(function (l, i) {
          if (ed === i) {
            return '<div style="border:1px solid var(--accent);border-radius:9px;padding:15px">' +
              '<div class="stack" style="gap:10px">' +
                '<div class="field"><label for="al-t">Module title</label><input id="al-t" value="' + esc(l.title) + '"></div>' +
                '<div class="field"><label for="al-b">Body</label>' +
                  '<textarea id="al-b" rows="14" style="background:var(--surface);border:1px solid var(--line-strong);border-radius:8px;padding:10px;font-size:13.5px;line-height:1.6;width:100%">' + esc(l.body) + "</textarea></div>" +
                '<div class="row"><button class="btn primary sm" data-action="al-save" data-i="' + i + '">Publish changes</button>' +
                  '<button class="btn sm" data-action="al-cancel">Cancel</button></div>' +
              "</div></div>";
          }
          return '<div style="border:1px solid var(--line);border-radius:9px;padding:13px">' +
            '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
              '<p style="font-weight:500"><span class="pill" style="margin-right:6px">' + (i + 1) + "</span>" + esc(l.title) + "</p>" +
              '<button class="btn sm" data-action="al-edit" data-i="' + i + '">Edit</button></div>' +
            '<p class="tiny muted" style="margin-top:8px">' + esc(l.body.slice(0, 160)) + "&hellip;</p></div>";
        }).join("") +
      "</div>";
  }

  function viewAdminDrafts() {
    var drafts = allDrafts();
    return '<div class="page-head"><div class="eyebrow">Review queue</div><h1>Question drafts awaiting publish</h1>' +
      '<p class="sub">Nothing here is live yet. Publishing swaps the draft in and archives the version it replaces, so a score recorded against the old version stays explainable.</p></div>' +
      (drafts.length === 0
        ? '<div class="card"><p class="muted">The queue is empty. Edit a question in Content to create a draft.</p>' +
          '<button class="btn sm primary" style="margin-top:12px" data-action="nav" data-nav="a-content">Open content</button></div>'
        : '<div class="stack">' + drafts.map(function (d) {
            return draftCard(d.role, d.skill, d.draft);
          }).join("") + "</div>");
  }

  function draftCard(r, s, d) {
    var q = d.isNew ? null : findQ(s, d.qid);
    var cur = q ? { q: q.q, opts: q.opts, a: q.a, lvl: q.lvl, why: q.why } : null;
    var nx = d.fields;
    function fld(label, curV, nxV) {
      var changed = String(curV) !== String(nxV);
      return { label: label, cur: curV, next: nxV, changed: changed };
    }
    var fields = cur ? [
      fld("Question", cur.q, nx.q),
      fld("Option A", cur.opts[0], nx.opts[0]),
      fld("Option B", cur.opts[1], nx.opts[1]),
      fld("Option C", cur.opts[2], nx.opts[2]),
      fld("Option D", cur.opts[3], nx.opts[3]),
      fld("Correct", "ABCD"[cur.a], "ABCD"[nx.a]),
      fld("Level", "L" + cur.lvl, "L" + nx.lvl),
      fld("Explanation", cur.why, nx.why)
    ] : null;

    return '<div class="card">' +
      '<div class="row" style="justify-content:space-between;margin-bottom:12px;gap:12px">' +
        "<div><h3 style=\"font-size:15px\">" + esc(s.name) + "</h3>" +
          '<p class="ver" style="margin-top:3px">' + esc(r.name) + " &middot; " + esc(d.qid) +
            (q ? " &middot; live v" + q.v + " &rarr; v" + (q.v + 1) : " &middot; new question") + " &middot; drafted " + esc(d.created) + "</p></div>" +
        '<div class="row" style="gap:6px;flex-wrap:nowrap">' +
          '<button class="btn sm primary" data-action="a-publish" data-role="' + r.id + '" data-skill="' + s.id + '" data-qid="' + d.qid + '">Publish</button>' +
          '<button class="btn sm" data-action="a-discard" data-role="' + r.id + '" data-skill="' + s.id + '" data-qid="' + d.qid + '">Discard</button>' +
        "</div></div>" +

      (fields
        ? '<div class="diff-grid">' +
            '<div class="diff-col"><h4>Currently live &middot; v' + q.v + "</h4>" +
              fields.map(function (f) {
                return '<div class="diff-field ' + (f.changed ? "changed" : "") + '"><span class="fl">' + f.label + '</span><span class="fv">' + esc(f.cur) + "</span></div>";
              }).join("") + "</div>" +
            '<div class="diff-col next"><h4>Proposed &middot; v' + (q.v + 1) + "</h4>" +
              fields.map(function (f) {
                return '<div class="diff-field ' + (f.changed ? "changed" : "") + '"><span class="fl">' + f.label + '</span><span class="fv">' + esc(f.next) + "</span></div>";
              }).join("") + "</div>" +
          "</div>"
        : '<div class="diff-col next"><h4>New question</h4>' +
            '<div class="diff-field"><span class="fl">Question</span><span class="fv">' + esc(nx.q) + "</span></div>" +
            [0, 1, 2, 3].map(function (j) {
              return '<div class="diff-field"><span class="fl">Option ' + "ABCD"[j] + '</span><span class="fv">' + esc(nx.opts[j]) + "</span></div>";
            }).join("") +
            '<div class="diff-field"><span class="fl">Correct</span><span class="fv">' + "ABCD"[nx.a] + "</span></div>" +
            '<div class="diff-field"><span class="fl">Level</span><span class="fv">L' + nx.lvl + "</span></div>" +
            '<div class="diff-field"><span class="fl">Explanation</span><span class="fv">' + esc(nx.why) + "</span></div>" +
          "</div>") +
    "</div>";
  }

  function viewAdminStudents(user) {
    var all = state.users.filter(function (u) { return u.role === "student"; });
    var f = state.studentFilter;
    var schools = all.reduce(function (a, u) { return a.indexOf(u.school) > -1 ? a : a.concat([u.school]); }, []).sort();
    var q = f.q.toLowerCase();

    var students = all.filter(function (u) {
      if (f.role !== "all" && u.roleId !== f.role) return false;
      if (f.school !== "all" && u.school !== f.school) return false;
      if (q && u.name.toLowerCase().indexOf(q) === -1 && u.email.toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return b.points - a.points; });

    var filtered = f.role !== "all" || f.school !== "all" || !!q;
    var attempts = students.reduce(function (a, u) {
      return a + Object.keys(u.progress).reduce(function (b, k) { return b + u.progress[k].history.length; }, 0);
    }, 0);

    return '<div class="page-head"><div class="eyebrow">Students</div><h1>Registered learners</h1>' +
      '<p class="sub">Read-only. Admins can see progress but cannot alter a student&rsquo;s stars, since verified progress must come from assessment alone.</p></div>' +

      '<div class="filter-bar">' +
        '<div class="field"><label for="sf-role">Target role</label><select id="sf-role" data-filter="role">' +
          '<option value="all"' + (f.role === "all" ? " selected" : "") + ">All roles</option>" +
          ROLES.map(function (r) {
            return '<option value="' + r.id + '"' + (f.role === r.id ? " selected" : "") + ">" + esc(r.name) + "</option>";
          }).join("") + "</select></div>" +
        '<div class="field"><label for="sf-school">School</label><select id="sf-school" data-filter="school">' +
          '<option value="all"' + (f.school === "all" ? " selected" : "") + ">All schools</option>" +
          schools.map(function (s) {
            return '<option value="' + esc(s) + '"' + (f.school === s ? " selected" : "") + ">" + esc(s) + "</option>";
          }).join("") + "</select></div>" +
        '<div class="field"><label for="sf-q">Search name or email</label>' +
          '<input id="sf-q" data-filter="q" value="' + esc(f.q) + '" placeholder="Start typing"></div>' +
        '<button class="btn sm" data-action="sf-clear"' + (filtered ? "" : " disabled") + ">Clear</button>" +
      "</div>" +

      '<div class="summary-row">' +
        summaryCell("Showing", students.length + (filtered ? "<small> of " + all.length + "</small>" : "")) +
        summaryCell("Schools", String(students.reduce(function (a, u) { return a.indexOf(u.school) > -1 ? a : a.concat([u.school]); }, []).length)) +
        summaryCell("Certificates issued", String(students.reduce(function (a, u) { return a + certsFor(u).length; }, 0))) +
        summaryCell("Assessments taken", String(attempts)) +
      "</div>" +

      (students.length === 0
        ? '<div class="card"><p class="muted">No students match these filters.</p>' +
          '<button class="btn sm" style="margin-top:12px" data-action="sf-clear">Clear filters</button></div>'
        : '<div class="card" style="padding:14px 16px"><div class="scroll-x"><table class="grid">' +
          "<thead><tr><th>Name</th><th>School</th><th>Target role</th><th>Stars</th><th>Points</th><th>Certs</th></tr></thead><tbody>" +
          students.map(function (u) {
            return '<tr><td><button class="linkbtn" data-action="a-student" data-id="' + u.id + '">' + esc(u.name) + "</button></td>" +
              "<td>" + esc(u.school) + "</td>" +
              "<td>" + esc(role(u.roleId) ? role(u.roleId).name : "&mdash;") + "</td>" +
              '<td class="mono">' + totalStars(u) + '</td><td class="mono">' + u.points + '</td><td class="mono">' + certsFor(u).length + "</td></tr>";
          }).join("") + "</tbody></table></div></div>") +

      '<p class="tiny muted" style="margin-top:14px">Select a name to open that student&rsquo;s profile. Filtering by role and school together is how you read a single leaderboard cohort, since students only compete within their own school and target role.</p>';
  }

  function viewAdminStudent() {
    var u = state.users.filter(function (x) { return x.id === state.adminStudent; })[0];
    if (!u) return viewAdminStudents();
    var r = role(u.roleId);

    var rows = r ? r.skills.map(function (s) {
      var p = prog(u, s.id);
      var status = p.stars > 0 ? "verified" : (p.lessonsDone.length ? "studying" : "none");
      return { s: s, p: p, status: status };
    }) : [];

    var studying = rows.filter(function (x) { return x.status === "studying"; });
    var hist = [];
    rows.forEach(function (x) {
      x.p.history.forEach(function (h, i) { hist.push({ s: x.s, h: h, n: i + 1, of: x.p.history.length }); });
    });
    hist.reverse();
    var lessonsRead = rows.reduce(function (a, x) { return a + x.p.lessonsDone.length; }, 0);
    var lessonsTotal = rows.reduce(function (a, x) { return a + x.s.lessons.length; }, 0);

    return '<div class="page-head">' +
        '<button class="btn sm ghost" style="margin-bottom:10px" data-action="nav" data-nav="a-students">&larr; Students</button>' +
        '<div class="eyebrow">Student profile</div><h1>' + esc(u.name) + "</h1>" +
        '<p class="sub">' + esc(u.email) + " &middot; " + esc(u.school) +
          (u.major ? " &middot; " + esc(u.major) : "") +
          (u.gradYear ? " &middot; Class of " + esc(u.gradYear) : "") +
          " &middot; Target role: " + esc(r ? r.name : "not chosen yet") + "</p></div>" +

      '<div class="summary-row">' +
        summaryCell("Verified skills", verifiedCount(u) + (r ? "<small> / " + r.skills.length + "</small>" : "")) +
        summaryCell("Stars", totalStars(u) + (r ? "<small> / " + maxStars(u) + "</small>" : "")) +
        summaryCell("Points", String(u.points)) +
        summaryCell("Certificates", String(certsFor(u).length)) +
      "</div>" +

      (!r ? '<div class="card"><p class="muted">This student has not chosen a target role yet, so there is no roadmap to report on.</p></div>' :
      '<div class="stack">' +

        '<div class="card">' +
          '<div class="row" style="justify-content:space-between;margin-bottom:12px;gap:10px">' +
            '<h3 style="font-size:15px">Roadmap progress</h3>' +
            '<span class="pill">' + lessonsRead + " / " + lessonsTotal + " modules read</span></div>" +
          '<div class="scroll-x"><table class="grid">' +
            "<thead><tr><th>Skill</th><th>Status</th><th>Stars</th><th>Best</th><th>Attempts</th><th>Modules read</th><th>Project</th></tr></thead><tbody>" +
            rows.map(function (x) {
              var pill = x.status === "verified" ? '<span class="pill ok">' + LEVELS[x.p.stars].label + "</span>"
                : x.status === "studying" ? '<span class="pill warn">Studying</span>'
                : '<span class="pill">Not started</span>';
              return "<tr><td>" + esc(x.s.name) + "</td><td>" + pill + "</td>" +
                "<td>" + starHTML(x.p.stars) + "</td>" +
                '<td class="mono">' + (x.p.attempts ? x.p.best + "%" : "&mdash;") + "</td>" +
                '<td class="mono">' + (x.p.attempts || "&mdash;") + "</td>" +
                '<td class="mono">' + x.p.lessonsDone.length + " / " + x.s.lessons.length + "</td>" +
                "<td>" + (x.p.project ? '<span class="pill ok">Submitted</span>' : '<span class="tiny muted">&mdash;</span>') + "</td></tr>";
            }).join("") +
          "</tbody></table></div>" +
          (studying.length
            ? '<p class="tiny muted" style="margin-top:12px">Currently studying without a verified result: ' +
              studying.map(function (x) { return esc(x.s.name); }).join(", ") + ".</p>"
            : "") +
        "</div>" +

        '<div class="card">' +
          '<h3 style="font-size:15px;margin-bottom:12px">Assessment history</h3>' +
          (hist.length === 0
            ? '<p class="tiny muted">No scored attempts yet.</p>'
            : '<div class="scroll-x"><table class="grid">' +
              "<thead><tr><th>When</th><th>Skill</th><th>Attempt</th><th>Score</th><th>Level awarded</th></tr></thead><tbody>" +
              hist.map(function (x) {
                return '<tr><td class="mono tiny">' + esc(x.h.when) + "</td><td>" + esc(x.s.name) + "</td>" +
                  '<td class="mono tiny">' + x.n + " of " + x.of + "</td>" +
                  '<td class="mono">' + x.h.pct + "%</td><td>" + starHTML(x.h.stars) +
                  ' <span class="tiny muted">' + LEVELS[x.h.stars].label + "</span></td></tr>";
              }).join("") + "</tbody></table></div>") +
        "</div>" +

        '<div class="card">' +
          '<h3 style="font-size:15px;margin-bottom:12px">Certificates issued</h3>' +
          (certsFor(u).length === 0
            ? '<p class="tiny muted">None yet. A certificate is issued at ' + STAR + STAR + STAR + " or above.</p>"
            : '<div class="scroll-x"><table class="grid">' +
              "<thead><tr><th>Skill</th><th>Level</th><th>Score</th><th>Verification ID</th></tr></thead><tbody>" +
              certsFor(u).map(function (c) {
                return "<tr><td>" + esc(c.skill.name) + "</td><td>" + starHTML(c.p.stars) +
                  ' <span class="tiny muted">' + LEVELS[c.p.stars].label + "</span></td>" +
                  '<td class="mono">' + c.p.best + '%</td><td class="mono tiny">' + verifyId(u, c.skill.id) + "</td></tr>";
              }).join("") + "</tbody></table></div>") +
        "</div>" +
      "</div>") +

      '<p class="tiny muted" style="margin-top:14px">Read-only. Stars, scores and certificates here can only be changed by the student taking an assessment, which is what makes a verified level mean something.</p>';
  }

  /* ---------------- render ---------------- */

  function previewBar() {
    var s = skill(state.preview.roleId, state.preview.skillId);
    return '<div class="preview-bar">' +
      '<span class="pv-label">Preview as student &middot; ' + esc(s.name) + "</span>" +
      '<span class="pv-note">Nothing here is recorded. No score, no stars, no leaderboard points.</span>' +
      '<button class="btn sm" data-action="exit-preview">Exit preview</button></div>';
  }

  function render() {
    var user = me();
    if (!user) {
      renderAuth();
      if (typeof updateTutor === "function") updateTutor();   // the rail must not sit over the sign-in page
      return;
    }
    renderShell(user);

    var v = document.getElementById("view");
    var n = state.route.name;
    var subject = actor();
    var html;

    if (state.preview) {
      html = previewBar() +
        (n === "learn" ? viewLearn(subject) :
         n === "assess" ? viewExam(subject) :
         n === "result" ? viewResult(subject) :
         viewSkill(subject));
    } else if (user.role === "admin") {
      if (["a-content", "a-bank", "a-lessons", "a-drafts", "a-students", "a-student", "profile"].indexOf(n) === -1) n = "a-content";
      html =
        n === "a-bank" ? viewAdminBank() :
        n === "a-lessons" ? viewAdminLessons() :
        n === "a-drafts" ? viewAdminDrafts() :
        n === "a-student" ? viewAdminStudent() :
        n === "a-students" ? viewAdminStudents(user) :
        n === "profile" ? viewProfile(user) :
        viewAdminContent();
    } else {
      if (!user.roleId && n !== "roles" && n !== "profile") n = "roles";
      html =
        n === "roles" ? viewRoles(user) :
        n === "skill" ? viewSkill(user) :
        n === "learn" ? viewLearn(user) :
        n === "assess" ? viewExam(user) :
        n === "result" ? viewResult(user) :
        n === "certs" ? viewCerts(user) :
        n === "cert" ? viewCert(user) :
        n === "leaderboard" ? viewLeaderboard(user) :
        n === "history" ? viewHistory(user) :
        n === "profile" ? viewProfile(user) :
        viewRoadmap(user);
    }
    v.innerHTML = html;
    if (typeof updateTutor === "function") updateTutor();
  }

  /* ---------------- actions ---------------- */

  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }

  var actions = {
    "auth-tab": function (el) { state.authTab = el.dataset.tab; state.authError = ""; render(); },

    fill: function (el) {
      var e = document.getElementById("li-email"), p = document.getElementById("li-pass");
      if (e) e.value = el.dataset.email;
      if (p) p.value = el.dataset.pass;
    },

    signup: function () {
      var name = val("su-name"), email = val("su-email"), pass = val("su-pass");
      if (!name || !email || !pass) { state.authError = "Name, email, and password are all required."; return render(); }
      if (pass.length < 4) { state.authError = "Password must be at least 4 characters."; return render(); }
      if (state.users.some(function (u) { return u.email.toLowerCase() === email.toLowerCase(); })) {
        state.authError = "An account already exists for that email. Try signing in."; return render();
      }
      var u = newUser({ name: name, email: email, password: pass, role: "student",
        school: val("su-school"), major: val("su-major"), gradYear: val("su-year") });
      state.users.push(u);
      state.userId = u.id; state.authError = "";
      go("roles");
    },

    login: function () {
      var email = val("li-email"), pass = val("li-pass");
      var u = state.users.filter(function (x) {
        return x.email.toLowerCase() === email.toLowerCase() && x.password === pass && !x.seeded;
      })[0];
      if (!u) { state.authError = "No account matches that email and password."; return render(); }
      state.userId = u.id; state.authError = "";
      go(u.role === "admin" ? "a-content" : (u.roleId ? "roadmap" : "roles"));
    },

    logout: function () {
      state.userId = null; state.authTab = "login"; state.exam = null; state.quiz = null;
      state.preview = null; state.adminSkill = null; state.adminEdit = null;
      tutor.turns = []; tutor.quote = ""; tutor.open = false;   // don't leak one student's chat to the next
      render();
    },

    nav: function (el) { state.adminEdit = null; state.adminLesson = null; go(el.dataset.nav); },

    theme: function () {
      var root = document.documentElement;
      var cur = root.getAttribute("data-theme");
      var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.setAttribute("data-theme", cur ? (cur === "dark" ? "light" : "dark") : (systemDark ? "light" : "dark"));
    },

    "pick-role": function (el) { me().roleId = el.dataset.role; go("roadmap"); },

    "open-skill": function (el) { state.quiz = null; go("skill", { skill: el.dataset.skill }); },

    "start-learn": function (el) {
      state.lessonIdx = el.dataset.lesson ? +el.dataset.lesson : 0;
      state.quiz = null;
      markLesson(el.dataset.skill, state.lessonIdx);
      go("learn", { skill: el.dataset.skill });
    },

    lesson: function (el) {
      state.lessonIdx = +el.dataset.i;
      markLesson(state.route.skill, state.lessonIdx);
      window.scrollTo(0, 0);
      render();
    },

    "practice-check": function (el) {
      var key = el.dataset.key;
      var st = pstate(key);
      var parts = key.split("-");
      var i = +parts.pop();
      var s = skill(actor().roleId, parts.join("-"));
      var box = document.querySelector('[data-practice="' + key + '"]');
      if (box) st.text = box.value;
      st.checked = runCheck(s.practice[i], st.text);
      if (!st.checked.empty) st.tries++;
      render();
    },

    "practice-hint": function (el) {
      var st = pstate(el.dataset.key);
      st.hints++;
      render();
    },

    "practice-answer": function (el) {
      var st = pstate(el.dataset.key);
      st.shown = !st.shown;
      render();
    },

    "start-quiz": function (el) { state.quiz = { skillId: el.dataset.skill, idx: 0, answers: [], done: false }; render(); },

    "quiz-answer": function (el) {
      var q = state.quiz;
      var s = skill(actor().roleId, q.skillId);
      q.answers.push(+el.dataset.i);
      q.idx++;
      if (q.idx >= s.quiz.length) q.done = true;
      render();
    },

    "start-exam": function (el) {
      state.exam = { skillId: el.dataset.skill, idx: 0, answers: [] };
      go("assess", { skill: el.dataset.skill });
    },

    "exam-answer": function (el) {
      var e = state.exam;
      var subject = actor();
      var s = skill(subject.roleId, e.skillId);
      e.answers.push(+el.dataset.i);
      e.idx++;
      if (e.idx < s.assessment.length) { window.scrollTo(0, 0); return render(); }
      finishExam(subject, s, e);
    },

    "submit-project": function (el) {
      var u = actor();
      var p = prog(u, el.dataset.skill);
      if (p.project) return;
      p.project = true;
      if (!state.preview) u.points += 150;
      if (p.best >= 95 && p.stars < 5) { if (!state.preview) u.points += 100; p.stars = 5; }
      render();
    },

    "open-cert": function (el) { go("cert", { skill: el.dataset.skill }); },

    /* ---- admin ---- */

    "a-open": function (el) {
      state.adminSkill = { roleId: el.dataset.role, skillId: el.dataset.skill };
      state.adminEdit = null; state.adminHistory = null;
      go("a-bank");
    },
    "a-lessons": function (el) {
      state.adminSkill = { roleId: el.dataset.role, skillId: el.dataset.skill };
      state.adminLesson = null;
      go("a-lessons");
    },
    "a-edit": function (el) { state.adminEdit = el.dataset.qid; render(); },
    "a-new": function () { state.adminEdit = "new"; render(); },
    "a-cancel": function () { state.adminEdit = null; render(); },
    "a-history": function (el) {
      state.adminHistory = state.adminHistory === el.dataset.qid ? null : el.dataset.qid;
      render();
    },

    "a-save": function (el) {
      var s = skill(state.adminSkill.roleId, state.adminSkill.skillId);
      var fields = {
        q: val("ae-q"), opts: [0, 1, 2, 3].map(function (j) { return val("ae-o" + j); }),
        a: +val("ae-a"), lvl: +val("ae-l"), why: val("ae-w")
      };
      if (!fields.q || fields.opts.some(function (o) { return !o; })) return;
      var isNew = el.dataset.qid === "new";
      var qid = isNew ? s.id + "-q" + (s.assessment.length + s.drafts.length + 1) + "n" : el.dataset.qid;
      s.drafts = s.drafts.filter(function (d) { return d.qid !== qid; });
      s.drafts.push({ qid: qid, fields: fields, isNew: isNew, created: today() });
      state.adminEdit = null;
      go("a-drafts");
    },

    "a-review-one": function (el) { go("a-drafts"); },

    "a-publish": function (el) {
      var s = skill(el.dataset.role, el.dataset.skill);
      publishDraft(s, el.dataset.qid);
      render();
    },
    "a-discard": function (el) {
      var s = skill(el.dataset.role, el.dataset.skill);
      s.drafts = s.drafts.filter(function (d) { return d.qid !== el.dataset.qid; });
      render();
    },
    "a-retire": function (el) {
      var s = skill(state.adminSkill.roleId, state.adminSkill.skillId);
      retireQuestion(s, el.dataset.qid);
      render();
    },

    "al-edit": function (el) { state.adminLesson = +el.dataset.i; render(); },
    "al-cancel": function () { state.adminLesson = null; render(); },
    "al-save": function (el) {
      var s = skill(state.adminSkill.roleId, state.adminSkill.skillId);
      var l = s.lessons[+el.dataset.i];
      var t = val("al-t"), b = val("al-b");
      if (t) l.title = t;
      if (b) l.body = b;
      state.adminLesson = null;
      render();
    },

    preview: function (el) {
      var ctx = state.adminSkill;
      state.preview = {
        roleId: ctx.roleId, skillId: ctx.skillId,
        user: { id: "preview", name: "Preview", school: "CareerPath", roleId: ctx.roleId,
                points: 0, progress: {}, role: "student", preview: true }
      };
      state.quiz = null;
      if (el.dataset.mode === "assess") {
        state.exam = { skillId: ctx.skillId, idx: 0, answers: [] };
        go("assess", { skill: ctx.skillId });
      } else {
        state.lessonIdx = 0;
        go("learn", { skill: ctx.skillId });
      }
    },

    "a-student": function (el) { state.adminStudent = el.dataset.id; go("a-student"); },

    "sf-clear": function () {
      state.studentFilter = { role: "all", school: "all", q: "" };
      render();
    },

    "exit-preview": function () {
      state.preview = null; state.exam = null; state.quiz = null; state.result = null;
      go("a-bank");
    }
  };

  function markLesson(skillId, i) {
    var p = prog(actor(), skillId);
    if (p.lessonsDone.indexOf(i) === -1) p.lessonsDone.push(i);
  }

  function finishExam(user, s, e) {
    var right = e.answers.filter(function (a, i) { return a === s.assessment[i].a; }).length;
    var pct = Math.round(right / s.assessment.length * 100);
    var p = prog(user, s.id);
    var award = awardFor(pct, p.project);

    p.attempts++;
    var pointsAwarded = 0, improved = false;

    if (!state.preview) {
      p.history.push({ pct: pct, stars: award.stars, when: today() });
      if (award.stars > p.stars) {
        pointsAwarded = (award.stars - p.stars) * 100;
        user.points += pointsAwarded;
        p.stars = award.stars;
        improved = true;
      }
      if (pct > p.best) { p.best = pct; improved = true; }
    }

    state.result = { skillId: s.id, pct: pct, right: right, answers: e.answers, award: award,
      newStars: pointsAwarded > 0 || improved, pointsAwarded: pointsAwarded };
    state.exam = null;
    go("result");
  }

  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-action]");
    if (!el) return;
    var fn = actions[el.dataset.action];
    if (fn) { ev.preventDefault(); fn(el); }
  });

  document.addEventListener("change", function (ev) {
    var el = ev.target.closest && ev.target.closest("[data-filter]");
    if (!el || el.tagName !== "SELECT") return;
    state.studentFilter[el.dataset.filter] = el.value;
    render();
  });

  // The learner's attempt is stored without re-rendering, so the caret never jumps.
  document.addEventListener("input", function (ev) {
    var t = ev.target;
    if (t && t.dataset && t.dataset.practice) { pstate(t.dataset.practice).text = t.value; }
  });

  document.addEventListener("input", function (ev) {
    var el = ev.target.closest && ev.target.closest("[data-filter]");
    if (!el || el.tagName !== "INPUT") return;
    state.studentFilter[el.dataset.filter] = el.value;
    var pos = el.selectionStart;
    var id = el.id;
    render();
    var again = document.getElementById(id);
    if (again) {
      again.focus();
      try { again.setSelectionRange(pos, pos); } catch (e) { /* not all inputs support it */ }
    }
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    var auth = document.getElementById("auth");
    if (ev.target && ev.target.tagName === "INPUT" && auth && !auth.hidden) {
      var btn = document.querySelector('[data-action="signup"], [data-action="login"]');
      if (btn) { ev.preventDefault(); actions[btn.dataset.action](btn); }
    }
  });

  /* ================= AI study assistant =================
     Runs on the viewer's own Claude account through the artifact runtime.
     Two rules shape it: it teaches for the student's target role, and it is
     switched off during a graded assessment, because a verified level has to
     mean the student knew the answer. */

  /* Two backends, one interface. On claude.ai the page asks Claude through the
     artifact runtime. Deployed anywhere else it posts to /api/ask, a serverless
     function that holds the API key server-side so the key never reaches the browser. */
  var tutor = {
    fn: null, mode: null, ready: false, open: false, busy: false,
    turns: [], quote: "", ctl: null, denied: false, docked: true
  };

  // Docking is a per-viewer convenience, so browser storage is the right home for it
  // and the page must render correctly when storage is unavailable.
  var DOCK_MQ = window.matchMedia ? window.matchMedia("(min-width: 1080px)") : { matches: false };
  try {
    var saved = window.localStorage.getItem("cp-tutor-dock");
    if (saved === "0") tutor.docked = false;
  } catch (e) { /* private window, blocked storage: keep the default */ }

  function saveDock() {
    try { window.localStorage.setItem("cp-tutor-dock", tutor.docked ? "1" : "0"); } catch (e) { /* ignore */ }
  }
  function isDocked() { return tutorVisible() && tutor.docked && DOCK_MQ.matches; }

  var TUTOR_RULES =
    "You are the CareerPath study assistant. CareerPath is a platform where students learn the skills " +
    "for a specific target job role and prove them through assessment.\n\n" +
    "How to answer:\n" +
    "- Teach for the student's target role. The same skill means different things in different roles: " +
    "SQL for a Product Manager is funnels, retention and experiment readouts, while SQL for a Financial " +
    "Analyst is ledger periods and reconciliation. Answer through their role's lens.\n" +
    "- Be short. Two or three sentences unless they ask for more. Plain language. Explain a term the first " +
    "time you use it.\n" +
    "- Use the module text below when it covers the question. If it does not, say so in a few words and " +
    "answer from general knowledge.\n" +
    "- If they paste or select text and ask about it, explain that specific thing rather than the topic in general.\n" +
    "- Never write an em dash.\n\n" +
    "Limits:\n" +
    "- Only help with the skill they are studying, the course material, or how to use CareerPath. If asked " +
    "about anything else, say that in one line and offer to help with the module instead.\n" +
    "- Never hand over the answer to a scored assessment question. If a student asks what to pick, teach the " +
    "idea being tested and let them decide.\n\n" +
    "Current context:\n";

  function tutorContext() {
    var u = actor();
    if (!u) return "The student has not signed in.";
    var out = [];
    var r = role(u.roleId);
    if (r) out.push("Target role: " + r.name + " (" + r.tagline + ")");
    var n = state.route.name;
    var s = state.route.skill ? skill(u.roleId, state.route.skill) : null;

    if (s) {
      out.push("Skill: " + s.name);
      out.push("This skill's focus for this role: " + s.lens);
      var p = prog(u, s.id);
      out.push("Their level so far: " + (p.stars ? p.stars + " of 5 stars, " + LEVELS[p.stars].label : "not yet assessed"));
      if (n === "learn") {
        var l = s.lessons[Math.min(state.lessonIdx, s.lessons.length - 1)];
        out.push("Module they are reading: " + l.title);
        out.push("Module text:\n" + l.body.slice(0, 4500));
      }
      if (n === "result" && state.result) {
        out.push("They just scored " + state.result.pct + "% and were awarded " + state.result.award.label + ".");
      }
    } else if (n === "roadmap" || n === "roles") {
      out.push("They are looking at their roadmap, not a specific skill.");
    }
    return out.join("\n");
  }

  function tutorBlocked() { return state.route.name === "assess"; }

  function tutorVisible() {
    if (!tutor.ready || tutor.denied) return false;
    var u = me();
    if (!u) return false;
    return u.role === "student" || !!state.preview;
  }

  function tmd(text) {
    var html = "";
    String(text).split(/```/).forEach(function (seg, i) {
      if (i % 2) {
        html += "<pre>" + esc(seg.replace(/^[a-z]*\n/i, "").replace(/\n+$/, "")) + "</pre>";
      } else {
        seg.split(/\n{2,}/).forEach(function (p) {
          if (!p.trim()) return;
          html += "<p>" + esc(p.trim())
            .replace(/`([^`\n]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
            .replace(/\n/g, "<br>") + "</p>";
        });
      }
    });
    return html;
  }

  var TUTOR_ERR = {
    // artifact runtime
    not_granted: "You declined access, so the assistant is off for this page. Reload to be asked again.",
    sampling_disabled: "The assistant is not available on this account.",
    session_expired: "Your session expired. Sign in again and reload.",
    refused: "The model would not answer that one. Try asking it a different way.",
    prompt_too_large: "That is too much text to send at once. Select a smaller piece.",
    // shared
    rate_limited: "Too many questions at once, or the account is out of quota. Try again in a moment.",
    empty_completion: "No answer came back. Try asking for less at a time.",
    cancelled: "",
    upstream_error: "Something went wrong reaching the model. Try again.",
    // /api/ask
    no_backend: "The assistant needs its server function. On a deployment, check that api/ask is present.",
    no_key: "The server has no API key configured. Add OPENAI_API_KEY in the hosting settings and redeploy.",
    bad_key: "The API key was rejected. Check OPENAI_API_KEY in the hosting settings.",
    no_quota: "The API account is out of credit. Add credit to the provider account and try again.",
    bad_model: "The configured model is not available to this API account.",
    too_large: "That is too much text to send at once. Select a smaller piece.",
    upstream_unreachable: "Could not reach the model provider. Check the connection and try again.",
    bad_request: "The assistant sent a malformed request. Reload the page."
  };

  /* For a misconfiguration the server's own message names the exact fix, which is more
     use than generic copy while a deployment is being set up. */
  var TUTOR_SHOW_DETAIL = ["no_key", "bad_key", "no_quota", "bad_model", "rate_limited", "upstream_error"];

  function tutorErrCopy(code, message) {
    if (TUTOR_SHOW_DETAIL.indexOf(code) > -1 && message) return message;
    return TUTOR_ERR[code] || TUTOR_ERR.upstream_error;
  }

  /* ---- backend: the artifact runtime ---- */

  function askClaude(o) {
    var input = [{ role: "user", content: o.rules }];
    o.convo.forEach(function (t) { input.push({ role: t.role, content: t.content }); });
    if (input[input.length - 1].role !== "user") {
      input.push({ role: "user", content: o.convo[o.convo.length - 1].content });
    }
    return tutor.fn(input, {
      cache: false, modelTier: "default", signal: o.signal, onText: o.onText
    });
  }

  /* ---- backend: /api/ask ---- */

  function askApi(o) {
    return fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rules: o.rules, messages: o.convo }),
      signal: o.signal
    }).catch(function (e) {
      if (e && e.name === "AbortError") throw { code: "cancelled", message: "stopped" };
      throw { code: "upstream_unreachable", message: String(e && e.message || e) };
    }).then(function (res) {
      if (!res.ok) {
        if (res.status === 404) throw { code: "no_backend", message: "api/ask not found" };
        return res.json().catch(function () { return null; }).then(function (j) {
          var err = (j && j.error) || {};
          throw { code: err.code || "upstream_error", message: err.message || ("HTTP " + res.status) };
        });
      }
      var ctype = res.headers.get("content-type") || "";
      if (ctype.indexOf("text/event-stream") === -1 || !res.body) {
        return res.json().catch(function () { return null; }).then(function (j) {
          var t = j && (j.text ||
            (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content));
          if (!t) throw { code: "empty_completion", message: "no text" };
          if (o.onText) o.onText({ text: t, delta: t });
          return { text: t, truncated: false };
        });
      }
      return readStream(res.body, o);
    });
  }

  function readStream(body, o) {
    var reader = body.getReader();
    var decoder = new TextDecoder();
    var buffer = "", text = "";

    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) {
          if (!text.trim()) throw { code: "empty_completion", message: "no text" };
          return { text: text, truncated: false };
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split("\n");
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.indexOf("data:") !== 0) continue;
          var payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          var ev = null;
          try { ev = JSON.parse(payload); } catch (e) { continue; }
          if (ev.error) throw { code: "upstream_error", message: String(ev.error), text: text };
          if (ev.delta) {
            text += ev.delta;
            if (o.onText) o.onText({ text: text, delta: ev.delta });
          }
        }
        return pump();
      }, function (e) {
        if (o.signal && o.signal.aborted) throw { code: "cancelled", message: "stopped", text: text };
        throw { code: "upstream_error", message: String(e && e.message || e), text: text };
      });
    }
    return pump();
  }

  function askModel(o) {
    if (tutor.mode === "claude") return askClaude(o);
    return askApi(o);
  }

  function tutorLog() {
    var log = document.getElementById("tutor-log");
    if (!log) return;

    if (tutorBlocked()) {
      log.innerHTML = '<div class="t-locked"><b>The assistant is off during an assessment.</b>' +
        "Your stars are meant to show what you know without help. Finish the assessment and the assistant " +
        "comes back, including an explanation of anything you got wrong.</div>";
      return;
    }

    if (!tutor.turns.length) {
      log.innerHTML = '<div class="t-empty"><b>Ask about what you are reading.</b>' +
        "Select any text in the module and choose Ask about this, or type a question below.</div>";
      return;
    }

    log.innerHTML = tutor.turns.map(function (t) {
      if (t.role === "user") {
        return '<div class="t-msg you">' +
          (t.quote ? '<span class="t-quote">' + esc(t.quote.slice(0, 240)) + "</span>" : "") +
          esc(t.display || t.content) + "</div>";
      }
      if (t.error) return '<div class="t-msg err">' + esc(t.content) + "</div>";
      return '<div class="t-msg bot">' + (t.content ? tmd(t.content) : "<p><i>Thinking...</i></p>") + "</div>";
    }).join("");
    log.scrollTop = log.scrollHeight;
  }

  function updateTutor() {
    var wrap = document.getElementById("tutor");
    if (!wrap) return;
    var visible = tutorVisible();
    wrap.hidden = !visible;
    if (!visible) tutor.open = false;

    var launch = document.getElementById("tutor-launch");
    var panel = document.getElementById("tutor-panel");
    var blocked = tutorBlocked();
    var docked = isDocked();

    document.body.classList.toggle("tutor-docked", docked);
    panel.classList.toggle("docked", docked);

    launch.hidden = docked || tutor.open;
    launch.className = blocked ? "locked" : "";
    document.getElementById("tutor-launch-label").textContent = blocked ? "Assistant off" : "Ask";
    launch.setAttribute("aria-expanded", String(tutor.open || docked));

    panel.hidden = !(docked || tutor.open);
    document.getElementById("tutor-dock").hidden = docked || !DOCK_MQ.matches;
    document.getElementById("tutor-undock").hidden = !docked;
    document.getElementById("tutor-close").hidden = docked;

    if (!panel.hidden) {
      var u = actor();
      var s = state.route.skill && u ? skill(u.roleId, state.route.skill) : null;
      document.getElementById("tutor-sub").textContent =
        s ? s.name : (u && role(u.roleId) ? role(u.roleId).name + " roadmap" : "");
      document.getElementById("tutor-foot").hidden = blocked;
      var note = document.getElementById("tutor-note");
      if (note) {
        note.textContent = (tutor.mode === "claude"
          ? "Answers come from Claude. "
          : "Answers come from the AI model this deployment is configured with. ") +
          "Select any text in the lesson to ask about it.";
      }
      tutorLog();
      renderQuote();
    }
  }

  function renderQuote() {
    var box = document.getElementById("tutor-quote");
    if (!box) return;
    box.hidden = !tutor.quote;
    if (tutor.quote) document.getElementById("tutor-quote-text").textContent = tutor.quote;
  }

  function openTutor(quote) {
    if (!tutorVisible()) return;
    if (quote) tutor.quote = quote;
    tutor.open = true;
    updateTutor();
    var input = document.getElementById("tutor-input");
    if (input && !tutorBlocked()) input.focus();
  }

  function tutorSetBusy(on) {
    tutor.busy = on;
    var send = document.getElementById("tutor-send");
    var stop = document.getElementById("tutor-stop");
    if (send) { send.disabled = on; send.textContent = on ? "Asking" : "Ask"; }
    if (stop) stop.hidden = !on;
  }

  function tutorAsk(question, quote, displayAs) {
    if (!tutor.ready || tutor.busy || tutorBlocked()) return;
    var q = String(question || "").trim();
    if (!q) return;

    tutor.turns.push({ role: "user", content: q, quote: quote || "", display: displayAs || "" });
    var slot = { role: "assistant", content: "" };
    tutor.turns.push(slot);
    tutorLog();
    tutorSetBusy(true);

    // Standing instructions are sent separately; only the last few exchanges follow.
    var convo = tutor.turns.slice(0, -1)              // drop the empty slot being filled
      .filter(function (t) { return t.content && !t.error; })
      .slice(-8)
      .map(function (t) {
        return {
          role: t.role,
          content: t.quote ? 'About this text:\n"' + t.quote + '"\n\n' + t.content : t.content
        };
      });

    tutor.ctl = new AbortController();
    askModel({
      rules: TUTOR_RULES + tutorContext(),
      convo: convo,
      signal: tutor.ctl.signal,
      onText: function (u) { slot.content = u.text; tutorLog(); }
    }).then(function (res) {
      slot.content = res.text;
      tutorSetBusy(false);
      tutorLog();
    }).catch(function (e) {
      var code = (e && e.code) || "upstream_error";
      if (code === "cancelled") {
        slot.content = e.text || "";
        if (!slot.content) tutor.turns.splice(tutor.turns.indexOf(slot), 1);
      } else if (e && e.text) {
        slot.content = e.text;
        tutor.turns.push({ role: "assistant", content: tutorErrCopy(code, e && e.message), error: true });
      } else {
        slot.content = tutorErrCopy(code, e && e.message);
        slot.error = true;
      }
      // Hide the feature only when the viewer themselves has refused it or the platform
      // cannot serve it. A misconfigured deployment must stay visible: hiding the panel
      // also hides the message that says how to fix it, which is the worst moment to
      // disappear. Those errors are shown and the panel stays open.
      if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled",
           "capability_removed", "session_expired"].indexOf(code) > -1) {
        tutor.denied = true;
      }
      tutorSetBusy(false);
      tutorLog();
      updateTutor();
    });

    tutor.quote = "";
    renderQuote();
  }

  function initTutor() {
    // Served over http(s) outside claude.ai, the server function is the backend.
    function fallBackToApi() {
      if (/^https?:$/.test(window.location.protocol)) {
        tutor.mode = "api";
        tutor.ready = true;
      } else {
        tutor.mode = null;
        tutor.ready = false;      // opened as a local file: no backend, hide the feature
      }
      updateTutor();
    }

    if (window.claude && typeof window.claude.use === "function") {
      window.claude.use("sample").then(function (fn) {
        if (fn) {
          tutor.fn = fn;
          tutor.mode = "claude";
          tutor.ready = true;
          updateTutor();
        } else {
          fallBackToApi();
        }
      }).catch(fallBackToApi);
    } else {
      fallBackToApi();
    }

    document.getElementById("tutor-launch").addEventListener("click", function () { openTutor(); });

    document.getElementById("tutor").addEventListener("click", function (ev) {
      var el = ev.target.closest("[data-tutor]");
      if (!el) return;
      var what = el.dataset.tutor;
      if (what === "close") { tutor.open = false; updateTutor(); }
      if (what === "clear") { tutor.turns = []; tutor.quote = ""; updateTutor(); }
      if (what === "unquote") { tutor.quote = ""; renderQuote(); }
      if (what === "dock") { tutor.docked = true; tutor.open = false; saveDock(); updateTutor(); }
      if (what === "undock") { tutor.docked = false; tutor.open = false; saveDock(); updateTutor(); }
    });

    if (DOCK_MQ.addEventListener) DOCK_MQ.addEventListener("change", updateTutor);
    else if (DOCK_MQ.addListener) DOCK_MQ.addListener(updateTutor);

    document.getElementById("tutor-stop").addEventListener("click", function () {
      if (tutor.ctl) tutor.ctl.abort();
    });

    document.getElementById("tutor-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var input = document.getElementById("tutor-input");
      var q = input.value.trim();
      if (!q) return;
      input.value = "";
      tutorAsk(q, tutor.quote);
    });

    document.getElementById("tutor-input").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        document.getElementById("tutor-form").dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });

    // Select text anywhere in the page body to ask about that specific passage.
    var selBtn = document.getElementById("sel-ask");
    var pending = "";

    function hideSel() { selBtn.hidden = true; pending = ""; }

    function checkSelection() {
      if (!tutorVisible() || tutorBlocked()) return hideSel();
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return hideSel();
      var text = sel.toString().trim();
      if (text.length < 3 || text.length > 1200) return hideSel();
      var node = sel.anchorNode;
      var host = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!host || !host.closest("#view")) return hideSel();

      var rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) return hideSel();
      pending = text;
      selBtn.hidden = false;
      var rightEdge = window.innerWidth - (isDocked() ? 360 : 0);
      var top = Math.min(rect.bottom + 8, window.innerHeight - 44);
      var left = Math.min(Math.max(8, rect.left), rightEdge - 150);
      selBtn.style.top = top + "px";
      selBtn.style.left = left + "px";
    }

    document.addEventListener("mouseup", function () { setTimeout(checkSelection, 0); });
    document.addEventListener("touchend", function () { setTimeout(checkSelection, 0); });
    document.addEventListener("scroll", hideSel, true);
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") hideSel(); });

    selBtn.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
    selBtn.addEventListener("click", function () {
      var text = pending;
      hideSel();
      if (text) openTutor(text);
    });
  }

  // Result-page shortcut: explain a question the student got wrong.
  actions["tutor-explain"] = function (el) {
    var u = actor();
    var s = skill(u.roleId, state.result.skillId);
    var i = +el.dataset.i;
    var q = s.assessment[i];
    var chose = state.result.answers[i];
    openTutor();
    tutorAsk(
      "I just got this assessment question wrong and I want to understand why.\n\n" +
      "Question: " + q.q + "\n" +
      q.opts.map(function (o, j) { return "ABCD"[j] + ") " + o; }).join("\n") + "\n\n" +
      "I chose " + "ABCD"[chose] + ". The correct answer is " + "ABCD"[q.a] + ".\n\n" +
      "Explain why my answer is wrong and why the correct one is right, for my target role. " +
      "Then give me one short way to remember it.",
      "",
      "Why was my answer to question " + (i + 1) + " wrong?"
    );
  };

  seed();
  ensureVersioning();
  render();
  initTutor();
})();
