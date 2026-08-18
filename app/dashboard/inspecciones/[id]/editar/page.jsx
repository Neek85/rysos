'use client'

export const dynamic = 'force-dynamic'

import { useParams } from 'next/navigation'
import InspeccionForm from '@/components/features/inspecciones/InspeccionForm'

export default function EditarInspeccionPage() {
  const { id } = useParams()
  return <InspeccionForm id={id} />
}
