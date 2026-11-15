import { describe, expect, it } from "vitest";
import { inferredCareerScore } from "./career";

describe("inferred career matching", () => {
  it("relates an interest to rotations that share the specialty", () => {
    expect(inferredCareerScore("Cardiology", "Outpt Cards")).toBe(100);
    expect(inferredCareerScore("Cardiology", "EP")).toBe(100);
    expect(inferredCareerScore("Cardiology", "Cardiac ICU")).toBe(100);
    expect(inferredCareerScore("Cardiology", "Medical ICU")).toBe(0);
    expect(inferredCareerScore("Pulmonary/Critical Care", "MICU")).toBe(100);
    expect(inferredCareerScore("Pulmonary/Critical Care", "Outpt Pulm")).toBe(100);
    expect(inferredCareerScore("Pulmonary/Critical Care", "Cards")).toBe(0);
    expect(inferredCareerScore("Gastroenterology", "GI")).toBe(100);
    expect(inferredCareerScore("Gastroenterology", "Gastroenterology Consult")).toBe(100);
    expect(inferredCareerScore("Infectious Disease", "ID")).toBe(100);
    expect(inferredCareerScore("Infectious Disease", "Rapid Response")).toBe(0);
    expect(inferredCareerScore("Nephrology", "Outpt Neph")).toBe(100);
    expect(inferredCareerScore("Research", "Back-Up Resident / Research")).toBe(100);
    expect(inferredCareerScore("Emergency Medicine", "ED")).toBe(100);
    expect(inferredCareerScore("Dermatology", "Derm Clinic")).toBe(100);
    expect(inferredCareerScore("Hospital Medicine", "General Medicine Wards")).toBe(100);
    expect(inferredCareerScore("Hospital Medicine", "Outpt Cards")).toBe(0);
    expect(inferredCareerScore("Primary Care", "Ambulatory Medicine")).toBe(100);
    expect(inferredCareerScore("Primary Care", "Night Float Clinic")).toBe(0);
  });

  it("works for specialties outside internal medicine", () => {
    expect(inferredCareerScore("Orthopedic Surgery", "Ortho")).toBe(100);
    expect(inferredCareerScore("Orthopedic Surgery", "General Surgery")).toBe(0);
    expect(inferredCareerScore("General Surgery", "Vascular Surgery")).toBe(100);
    expect(inferredCareerScore("Vascular Surgery", "General Surgery")).toBe(0);
    expect(inferredCareerScore("Breast Imaging", "Breast Imaging")).toBe(100);
    expect(inferredCareerScore("Breast Imaging", "Cardiology")).toBe(0);
    expect(inferredCareerScore("Radiology", "Breast Imaging")).toBe(100);
    expect(inferredCareerScore("Interventional Radiology", "IR")).toBe(100);
    expect(inferredCareerScore("Interventional Radiology", "Diagnostic Radiology")).toBe(0);
    expect(inferredCareerScore("Anesthesiology", "Anesthesia")).toBe(100);
    expect(inferredCareerScore("Psychiatry", "Psych Consult")).toBe(100);
    expect(inferredCareerScore("Otolaryngology", "ENT")).toBe(100);
    expect(inferredCareerScore("Obstetrics and Gynecology", "OB/GYN")).toBe(100);
    expect(inferredCareerScore("Physical Medicine and Rehabilitation", "PM&R")).toBe(100);
    expect(inferredCareerScore("Pediatrics", "NICU")).toBe(100);
    expect(inferredCareerScore("Cardiology", "NICU")).toBe(0);
    expect(inferredCareerScore("Neurosurgery", "Neurology")).toBe(0);
    expect(inferredCareerScore("Neurology", "Stroke")).toBe(100);
    expect(inferredCareerScore("POCUS", "POCUS")).toBe(100);
  });
});
