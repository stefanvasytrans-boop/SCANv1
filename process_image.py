import cv2
import sys
import os

def process_image(input_path):
    print(f"DEBUG PYTHON: Iniciando procesado de {input_path}")
    
    if not os.path.exists(input_path):
        print("ERROR: Archivo no encontrado", file=sys.stderr)
        sys.exit(1)

    try:
        # Leer imagen
        img = cv2.imread(input_path)
        if img is None:
            print("ERROR: cv2.imread no pudo leer la imagen (archivo corrupto o formato no soportado).", file=sys.stderr)
            sys.exit(1)

        # Procesado OpenCV
        processed = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        cv2.putText(processed, "PROCESADO", (50, 50), 
                    cv2.FONT_HERSHEY_SIMPLEX, 1.5, (255, 255, 255), 3)

        # Guardar output
        output_path = input_path.replace('.jpg', '_out.jpg')
        cv2.imwrite(output_path, processed)

        # Devolver ruta a Node.js
        print(output_path)
        
    except Exception as e:
        print(f"ERROR FATAL EN PYTHON: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("ERROR: Falta argumento de ruta de imagen", file=sys.stderr)
        sys.exit(1)
    process_image(sys.argv[1])
