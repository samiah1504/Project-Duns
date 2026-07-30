import json
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.label_template import LabelTemplate
from app.schemas.label_template import LabelTemplateCreate, LabelTemplateUpdate, LabelTemplateOut
from app.routers.auth import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("", response_model=List[LabelTemplateOut])
async def list_templates(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LabelTemplate).order_by(LabelTemplate.created_at))
    return result.scalars().all()


@router.post("", response_model=LabelTemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(body: LabelTemplateCreate, db: AsyncSession = Depends(get_db)):
    if body.is_default:
        await db.execute(update(LabelTemplate).values(is_default=False))
    tmpl = LabelTemplate(
        name=body.name,
        is_default=body.is_default,
        data=json.dumps(body.data),
    )
    db.add(tmpl)
    await db.commit()
    await db.refresh(tmpl)
    return tmpl


@router.put("/{template_id}", response_model=LabelTemplateOut)
async def update_template(
    template_id: str, body: LabelTemplateUpdate, db: AsyncSession = Depends(get_db)
):
    tmpl = await db.get(LabelTemplate, template_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")

    if body.is_default:
        await db.execute(update(LabelTemplate).where(LabelTemplate.id != template_id).values(is_default=False))

    if body.name is not None:
        tmpl.name = body.name
    if body.is_default is not None:
        tmpl.is_default = body.is_default
    if body.data is not None:
        tmpl.data = json.dumps(body.data)

    await db.commit()
    await db.refresh(tmpl)
    return tmpl


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: str, db: AsyncSession = Depends(get_db)):
    tmpl = await db.get(LabelTemplate, template_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    await db.delete(tmpl)
    await db.commit()


@router.post("/{template_id}/set-default", response_model=LabelTemplateOut)
async def set_default(template_id: str, db: AsyncSession = Depends(get_db)):
    tmpl = await db.get(LabelTemplate, template_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    await db.execute(update(LabelTemplate).values(is_default=False))
    tmpl.is_default = True
    await db.commit()
    await db.refresh(tmpl)
    return tmpl
