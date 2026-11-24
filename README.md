# Editor PDF (Electron 22 — compatible con Windows 7)

Editor de PDF de escritorio generado con IA. Permite abrir, editar textos existentes, agregar textos, 
imágenes y formas, manejar páginas (agregar, borrar, duplicar, rotar, reordenar, extraer), numerar, 
marca de agua, exportar página a PNG, imprimir, deshacer/rehacer.

## Uso (en la PC de desarrollo, con Node.js 16 o superior)
    npm install
    npm start

## Instalador para Windows 7 / 8 / 10 / 11
    npm run dist
Genera en /dist: instalador (.exe, 64 y 32 bits) y versión portable (sin instalar).

## Requisitos en la PC con Windows 7
- Windows 7 con Service Pack 1.
- Actualizaciones KB4474419 y KB4490628 (soporte de certificados SHA-2), sino el .exe puede no abrir.
- Si la PC es de 32 bits usar el instalador ia32.

## Por qué Electron 22
Es la última versión de Electron que funciona en Windows 7. No recibe parches de seguridad:
usarla para abrir PDF propios o de confianza.

## Estructura
- main.js        proceso principal (ventana, menú, diálogos, protocolo app://)
- preload.js     puente seguro hacia la interfaz
- src/model.js   estado, historial, geometría y rotación
- src/export.js  guardado: arma el PDF final con pdf-lib
- src/ui.js      íconos, diálogos, menús contextuales, avisos, tema
- src/app.js     herramientas, páginas, miniaturas, atajos
