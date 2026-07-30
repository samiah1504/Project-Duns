/**
 * API-backed label template persistence.
 * All CRUD goes to the database; localStorage is used only as a
 * session-level "dirty" flag and for the selected-size preference.
 */

import {
  getLabelTemplatesAPI,
  createLabelTemplateAPI,
  updateLabelTemplateAPI,
  deleteLabelTemplateAPI,
  setDefaultLabelTemplateAPI,
} from '../services/api'
import { LabelTemplate } from './useLabelTemplates'

export interface APILabelTemplate {
  id: string
  name: string
  is_default: boolean
  data: LabelTemplate   // the full LabelTemplate object stored as JSON
  created_at: string
  updated_at: string
}

export async function fetchTemplates(): Promise<APILabelTemplate[]> {
  const res = await getLabelTemplatesAPI()
  return res.data
}

export async function saveNewTemplate(name: string, template: LabelTemplate): Promise<APILabelTemplate> {
  const res = await createLabelTemplateAPI({ name, data: template, is_default: false })
  return res.data
}

export async function overwriteTemplate(id: string, name: string, template: LabelTemplate): Promise<APILabelTemplate> {
  const res = await updateLabelTemplateAPI(id, { name, data: template })
  return res.data
}

export async function removeTemplate(id: string): Promise<void> {
  await deleteLabelTemplateAPI(id)
}

export async function markDefault(id: string): Promise<APILabelTemplate> {
  const res = await setDefaultLabelTemplateAPI(id)
  return res.data
}
