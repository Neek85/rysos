// Clase de error del Ingestor de Capas Espaciales — en un archivo separado
// (no 'use server') porque un módulo Server Actions solo puede exportar
// funciones async (Next.js lo exige); una clase exportada ahí rompe el
// build. Mismo patrón que lib/actions/socioActionError.js.

export class GisActionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'GisActionError'
  }
}
