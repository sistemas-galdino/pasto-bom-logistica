# Gera os ícones do PWA a partir do logo oficial da Rede do Campo / Pasto Bom.
#
#   python3 apps/frontend/scripts/gerar-icones.py
#
# Rodar só quando o logo mudar. A saída vai para public/ e é versionada — o
# build do Vite copia public/ como está, e o Docker leva junto.
#
# POR QUE UM RECORTE, E NÃO O LOGO INTEIRO
# ----------------------------------------
# O logo completo é panorâmico (1600x716) e tem três camadas: símbolo, letreiro
# "Rede do Campo" e a pastilha "PASTO BOM". Num ícone de tela inicial, que
# aparece com ~60 px, o letreiro fica com uns 4 px de altura — ilegível, e o
# conjunto vira uma mancha.
#
# Só o símbolo também não resolve sozinho: ele tem proporção 6,7:1
# (1505x225 px), e num quadrado viraria uma tira fina no meio. Por isso o
# recorte é PARA DENTRO do símbolo, na região herói — o sol (que está em
# x 752..1039) com a crista das colinas cruzando. Dá 1,70:1, que respira.
#
# Fundo branco, que é o fundo do próprio logo — e resolve de graça a exigência
# do iOS de apple-touch-icon opaco.

import os

from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
FONTE = os.path.join(AQUI, 'logo-fonte.jpeg')
DESTINO = os.path.join(AQUI, '..', 'public')

# Recorte herói, escolhido olhando os candidatos lado a lado (1,67:1).
CORTE = (700, 4, 1080, 228)


def simbolo() -> Image.Image:
    im = Image.open(FONTE).convert('RGB')
    c = im.crop(CORTE)
    # O JPEG deixa sujeira acinzentada perto do branco. Sem isso, o recorte
    # colado sobre branco puro mostra uma moldura cinza de leve.
    px = c.load()
    for y in range(c.height):
        for x in range(c.width):
            r, g, b = px[x, y]
            if r > 236 and g > 236 and b > 236:
                px[x, y] = (255, 255, 255)
    return c


def compor(sim: Image.Image, lado: int, ocupacao: float) -> Image.Image:
    """Símbolo centrado num quadrado branco, ocupando `ocupacao` da largura."""
    alvo_w = int(lado * ocupacao)
    alvo_h = int(sim.height * alvo_w / sim.width)
    esc = sim.resize((alvo_w, alvo_h), Image.LANCZOS)
    canvas = Image.new('RGB', (lado, lado), (255, 255, 255))
    canvas.paste(esc, ((lado - alvo_w) // 2, (lado - alvo_h) // 2))
    return canvas


sim = simbolo()
print(f'recorte: {sim.width}x{sim.height}  ({sim.width / sim.height:.2f}:1)')

# `any`: pode encostar mais nas bordas.
compor(sim, 512, 0.86).save(f'{DESTINO}/icone-512.png')
compor(sim, 192, 0.86).save(f'{DESTINO}/icone-192.png')

# iOS: 180x180, RGB sem alfa (o iOS pinta de preto o que for transparente).
compor(sim, 180, 0.86).save(f'{DESTINO}/apple-touch-icon.png')

# maskable: o Android recorta num círculo e come as bordas. Tudo o que importa
# tem de caber no círculo central de 80%.
#
# 0,66 é o limite útil: com o símbolo em 1,70:1, os cantos ficam a um raio de
# 0,383 do centro — círculo de 0,77, dentro dos 0,80 exigidos. A 0,70 já
# estouraria (0,81).
compor(sim, 512, 0.66).save(f'{DESTINO}/icone-maskable-512.png')

print('gerados: icone-512, icone-192, apple-touch-icon, icone-maskable-512')
