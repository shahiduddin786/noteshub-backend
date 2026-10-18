import {
  UNIVERSITIES,
  flattenSubjects,
  getSemesters,
  getSubjects,
  prettyName,
} from "../config/academic.js";

export const listUniversities = (req, res) => {
  return res.status(200).json({ success: true, universities: UNIVERSITIES });
};

export const listSemesters = (req, res) => {
  const university = String(req.query.university || "").toLowerCase();
  const semesters = getSemesters(university);
  if (!semesters) {
    return res.status(404).json({ success: false, message: "University not found" });
  }
  return res.status(200).json({ success: true, university, semesters });
};

export const listSubjects = (req, res) => {
  const university = String(req.query.university || "").toLowerCase();
  const semester = String(req.query.semester || "").toLowerCase();
  const subjects = getSubjects(university, semester);
  if (!subjects) {
    return res.status(404).json({ success: false, message: "No subjects found" });
  }
  return res.status(200).json({ success: true, university, semester, subjects });
};

export const searchAcademic = (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const scope = String(req.query.scope || "all").toLowerCase();
  if (!q) {
    return res.status(200).json({ success: true, query: "", results: [] });
  }

  const results = [];
  const matchUni = (u) =>
    u.name.toLowerCase().includes(q) ||
    u.shortName.toLowerCase().includes(q) ||
    u.id.includes(q);

  if (scope === "all" || scope === "university") {
    for (const u of UNIVERSITIES) {
      if (matchUni(u)) {
        results.push({
          kind: "university",
          id: u.id,
          title: u.name,
          subtitle: u.description,
          badge: "University",
          meta: u.tag,
          universityId: u.id,
        });
      }
    }
  }

  if (scope === "all" || scope === "semester") {
    for (const u of UNIVERSITIES) {
      for (const s of getSemesters(u.id) ?? []) {
        if (s.title.toLowerCase().includes(q) || `semester ${s.number}`.includes(q)) {
          results.push({
            kind: "semester",
            id: `${u.id}-${s.key}`,
            title: s.title,
            subtitle: u.shortName,
            badge: "Semester",
            meta: s.term,
            universityId: u.id,
            semesterKey: s.key,
          });
        }
      }
    }
  }

  if (scope === "all" || scope === "subject" || scope === "file") {
    for (const entry of flattenSubjects()) {
      const label = prettyName(entry.slug);
      if (label.toLowerCase().includes(q) || entry.slug.toLowerCase().includes(q)) {
        const uni = UNIVERSITIES.find((x) => x.id === entry.university);
        results.push({
          kind: "subject",
          id: `${entry.university}-${entry.semester}-${entry.slug}`,
          title: entry.parent ? `${label} (${prettyName(entry.parent)})` : label,
          subtitle: `${uni?.shortName ?? entry.university} · ${entry.semester.toUpperCase()}`,
          badge: entry.parent ? "Topic" : "Subject",
          meta: entry.parent
            ? `${entry.university}/${entry.semester}/${entry.parent}/${entry.slug}`
            : `${entry.university}/${entry.semester}/${entry.slug}`,
          universityId: entry.university,
          semesterKey: entry.semester,
          subjectSlug: entry.parent ?? entry.slug,
          subSubjectSlug: entry.parent ? entry.slug : null,
          notesPath: entry.parent
            ? `${entry.university}/${entry.semester}/${entry.parent}/${entry.slug}`
            : `${entry.university}/${entry.semester}/${entry.slug}`,
        });
      }
    }
  }

  return res.status(200).json({ success: true, query: req.query.q, results });
};
