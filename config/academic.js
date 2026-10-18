// Academic taxonomy served to clients (mobile + web).
// Ported from the web frontend reference (AccessNotes/Subjects static data) so
// folder-key content (university/semKey/subject[/subSubject]) is discoverable
// via API instead of hardcoded client lists. Folder keys must stay in sync
// with the `noteshub/<university>/<semKey>/<subject>[/<subSubject>]`
// Cloudinary asset folders and the Supabase `notes` bucket prefixes.

export const UNIVERSITIES = [
  {
    id: "mu",
    name: "Mumbai University (MU)",
    shortName: "Mumbai University",
    tag: "Popular",
    description: "Engineering & Technology",
  },
  {
    id: "msbte",
    name: "MSBTE",
    shortName: "MSBTE",
    tag: "Polytechnic",
    description: "Diploma in Engineering",
  },
];

const SEMESTERS = {
  mu: [
    { number: 3, key: "sem3", title: "Semester 3 - Second Year", term: "Odd Term" },
    { number: 4, key: "sem4", title: "Semester 4 - Second Year", term: "Even Term", isCurrent: true },
    { number: 5, key: "sem5", title: "Semester 5 - Third Year", term: "Odd Term" },
  ],
  msbte: [
    { number: 4, key: "sem4", title: "Semester 4 - Second Year", term: "Even Term", isCurrent: true },
    { number: 5, key: "sem5", title: "Semester 5 - Third Year", term: "Odd Term" },
    { number: 6, key: "sem6", title: "Semester 6 - Third Year", term: "Even Term" },
  ],
};

const SUBJECTS = {
  mu: {
    sem3: ["aoa", "coa", "maths", "dsgt", "genai", "important-answers"],
    sem4: [
      "syllabus",
      "cth",
      "os",
      "dbms",
      "web-technologies",
      "oe-ibs",
      "lab-experiments",
      "assignments",
      "Business-Model-Development",
      "Design-Thinking",
      "important-answers",
      "internal-assessments",
    ],
    sem5: ["syllabus", "lab-experiment", "internal-assessments-1"],
  },
  msbte: {
    sem4: ["important-questions", "microproject", "syllabus"],
    sem5: ["microproject", "answers", "manual"],
    sem6: ["eti", "important-answers", "manual", "mgt", "microproject"],
  },
};

const NESTED_SUBJECTS = {
  "lab-experiments": ["dbms-lab", "os-lab", "web-tech-lab"],
  assignments: ["cth", "dbms", "os", "web-tech", "ibs"],
  "lab-experiment": ["se-lab", "aisc-lab", "dwm-lab", "cn-lab", "wml-lab"],
};

export function prettyName(slug) {
  return String(slug)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getSemesters(university) {
  return SEMESTERS[university] ?? null;
}

export function getSubjects(university, semKey) {
  const list = SUBJECTS[university]?.[semKey];
  if (!list) return null;
  return list.map((slug) => ({
    slug,
    name: prettyName(slug),
    parent: null,
    children: (NESTED_SUBJECTS[slug] ?? []).map((child) => ({
      slug: child,
      name: prettyName(child),
      parent: slug,
    })),
    notesPath:
      NESTED_SUBJECTS[slug] == null
        ? `${university}/${semKey}/${slug}`
        : null,
  }));
}

export function flattenSubjects() {
  const out = [];
  for (const uni of Object.keys(SUBJECTS)) {
    for (const semKey of Object.keys(SUBJECTS[uni])) {
      for (const slug of SUBJECTS[uni][semKey]) {
        out.push({ university: uni, semester: semKey, slug, parent: null });
        for (const child of NESTED_SUBJECTS[slug] ?? []) {
          out.push({ university: uni, semester: semKey, slug: child, parent: slug });
        }
      }
    }
  }
  return out;
}
