import express from "express";
import {
  listSemesters,
  listSubjects,
  listUniversities,
  searchAcademic,
} from "../controllers/academicController.js";

const router = express.Router();

router.get("/universities", listUniversities);
router.get("/semesters", listSemesters);
router.get("/subjects", listSubjects);
router.get("/search", searchAcademic);

export default router;
