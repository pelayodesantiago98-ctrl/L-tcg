#!/bin/bash
sqlite3 /var/www/l-tcg/data/l-tcg.sqlite3 "SELECT valor FROM ingesta WHERE clave='mejora_imagenes';"
echo "--- por set (ultimas 5) ---"
sqlite3 /var/www/l-tcg/data/l-tcg.sqlite3 "SELECT set_code, estado, cartas_revisadas, cartas_mejoradas, error FROM mejora_imagenes ORDER BY actualizado DESC LIMIT 5;"
