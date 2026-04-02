import cv2
import sys
import os

def process_image(input_path):
    if not os.path.exists(input_path):
        print("ERROR: Archivo no encontrado", file=sys.stderr)
        sys.exit(1)

    # Leer imagen
    img = cv2.imread(input_path)

    # --- MAGIA OPENCV AQUÍ ---
    processed = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cv2.putText(processed, "PROCESADO", (50, 50), 
                cv2.FONT_HERSHEY_SIMPLEX, 1.5, (255, 255, 255), 3)

    # Guardar output
    output_path = input_path.replace('.jpg', '_out.jpg')
    cv2.imwrite(output_path, processed)

    # Enviar la ruta de vuelta a Node.js
    print(output_path)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("ERROR: Falta argumento", file=sys.stderr)
        sys.exit(1)
    process_image(sys.argv[1])
