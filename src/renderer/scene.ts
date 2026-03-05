import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Piece, ThemeName } from '../shared/chess';

interface RenderOptions {
  selectedSquare: number | null;
  highlightSquares: number[];
  theme: ThemeName;
  interactive: boolean;
}

interface ThemeResources {
  boardLight: THREE.MeshPhysicalMaterial;
  boardDark: THREE.MeshPhysicalMaterial;
  boardLightSelected: THREE.MeshPhysicalMaterial;
  boardDarkSelected: THREE.MeshPhysicalMaterial;
  boardLightHighlight: THREE.MeshPhysicalMaterial;
  boardDarkHighlight: THREE.MeshPhysicalMaterial;
  whitePiece: THREE.MeshPhysicalMaterial;
  blackPiece: THREE.MeshPhysicalMaterial;
  accent: THREE.ColorRepresentation;
  background: THREE.ColorRepresentation;
}

export class ChessScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly boardGroup = new THREE.Group();
  private readonly piecesGroup = new THREE.Group();
  private readonly squareMeshes = new Map<number, THREE.Mesh>();
  private readonly squareSize = 1.45;
  private readonly boardHeight = 0.24;
  private readonly themeMaterials = new Map<ThemeName, ThemeResources>();

  private currentTheme: ThemeName = 'glass';
  private interactive = true;
  private pointerDown = new THREE.Vector2();

  constructor(
    private readonly container: HTMLDivElement,
    private readonly onSquareSelected: (square: number) => void
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.container.appendChild(this.renderer.domElement);

    this.camera.position.set(8.5, 10.5, 9.5);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 20;
    this.controls.minPolarAngle = 0.45;
    this.controls.maxPolarAngle = 1.35;
    this.controls.target.set(0, 0.35, 0);

    this.scene.add(this.boardGroup);
    this.scene.add(this.piecesGroup);

    this.setupEnvironment();
    this.buildBoard();
    this.setTheme('glass');

    this.renderer.domElement.addEventListener('pointerdown', (event) => {
      this.pointerDown.set(event.clientX, event.clientY);
    });
    this.renderer.domElement.addEventListener('pointerup', (event) => this.handlePointerUp(event));
    window.addEventListener('resize', () => this.handleResize());

    this.animate();
  }

  public setTheme(theme: ThemeName): void {
    this.currentTheme = theme;
    if (!this.themeMaterials.has(theme)) {
      this.themeMaterials.set(theme, this.createThemeResources(theme));
    }
    const resources = this.themeMaterials.get(theme)!;
    this.scene.background = new THREE.Color(resources.background);
  }

  public renderPosition(board: Array<Piece | null>, options: RenderOptions): void {
    this.currentTheme = options.theme;
    this.interactive = options.interactive;

    if (!this.themeMaterials.has(options.theme)) {
      this.themeMaterials.set(options.theme, this.createThemeResources(options.theme));
    }
    const resources = this.themeMaterials.get(options.theme)!;

    for (const [square, mesh] of this.squareMeshes) {
      const isLight = (fileOf(square) + rankOf(square)) % 2 === 0;
      const isSelected = options.selectedSquare === square;
      const isHighlighted = options.highlightSquares.includes(square);

      if (isSelected) {
        mesh.material = isLight ? resources.boardLightSelected : resources.boardDarkSelected;
      } else if (isHighlighted) {
        mesh.material = isLight ? resources.boardLightHighlight : resources.boardDarkHighlight;
      } else {
        mesh.material = isLight ? resources.boardLight : resources.boardDark;
      }
    }

    this.disposePieceMeshes();
    this.piecesGroup.clear();
    board.forEach((piece, square) => {
      if (!piece) {
        return;
      }
      const mesh = this.createPiece(piece, resources);
      const { x, z } = squareToWorld(square, this.squareSize);
      mesh.position.set(x, this.boardHeight / 2, z);
      mesh.userData.square = square;
      this.piecesGroup.add(mesh);
    });
  }

  private setupEnvironment(): void {
    const ambient = new THREE.HemisphereLight(0xe6f6ff, 0x0d1422, 1.1);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(6, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    this.scene.add(key);

    const rim = new THREE.PointLight(0x93d8ff, 40, 30, 2);
    rim.position.set(-7, 5, -7);
    this.scene.add(rim);

    const warm = new THREE.PointLight(0xffccaa, 20, 20, 2);
    warm.position.set(7, 4, 7);
    this.scene.add(warm);

    const pedestalMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x101b2f,
      roughness: 0.25,
      metalness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.15
    });
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 7.8, 1.2, 64), pedestalMaterial);
    pedestal.position.set(0, -0.72, 0);
    pedestal.receiveShadow = true;
    this.scene.add(pedestal);

    const underGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(6.8, 6.8, 0.12, 64),
      new THREE.MeshBasicMaterial({ color: 0x163860, transparent: true, opacity: 0.65 })
    );
    underGlow.position.set(0, -0.05, 0);
    this.scene.add(underGlow);
  }

  private buildBoard(): void {
    const geometry = new THREE.BoxGeometry(this.squareSize, this.boardHeight, this.squareSize);

    for (let square = 0; square < 64; square += 1) {
      const mesh = new THREE.Mesh(geometry);
      const { x, z } = squareToWorld(square, this.squareSize);
      mesh.position.set(x, 0, z);
      mesh.receiveShadow = true;
      mesh.userData.square = square;
      this.squareMeshes.set(square, mesh);
      this.boardGroup.add(mesh);
    }

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(this.squareSize * 8 + 0.6, 0.32, this.squareSize * 8 + 0.6),
      new THREE.MeshPhysicalMaterial({
        color: 0x0b1728,
        roughness: 0.22,
        metalness: 0.45,
        clearcoat: 1
      })
    );
    frame.position.set(0, -0.09, 0);
    frame.receiveShadow = true;
    this.scene.add(frame);
  }

  private createThemeResources(theme: ThemeName): ThemeResources {
    if (theme === 'marble') {
      const lightTexture = createMarbleTexture('#eef3f8', '#d6dde7', '#c3ccd9');
      const darkTexture = createMarbleTexture('#273449', '#1a2437', '#42536a');
      const whitePieceTexture = createMarbleTexture('#f4f6f8', '#dde3ea', '#c6ced8');
      const blackPieceTexture = createMarbleTexture('#3a4049', '#1f242d', '#59606b');
      return {
        boardLight: physicalMaterial({ map: lightTexture, color: 0xf7f8fa, roughness: 0.38, metalness: 0.04 }),
        boardDark: physicalMaterial({ map: darkTexture, color: 0x314158, roughness: 0.34, metalness: 0.08 }),
        boardLightSelected: physicalMaterial({ map: lightTexture, color: 0xfff6c2, roughness: 0.25, metalness: 0.05 }),
        boardDarkSelected: physicalMaterial({ map: darkTexture, color: 0xbfa44d, roughness: 0.22, metalness: 0.08 }),
        boardLightHighlight: physicalMaterial({ map: lightTexture, color: 0xd7f0ff, roughness: 0.28, metalness: 0.04 }),
        boardDarkHighlight: physicalMaterial({ map: darkTexture, color: 0x6689b0, roughness: 0.24, metalness: 0.08 }),
        whitePiece: physicalMaterial({ map: whitePieceTexture, color: 0xffffff, roughness: 0.28, metalness: 0.02, clearcoat: 0.8 }),
        blackPiece: physicalMaterial({ map: blackPieceTexture, color: 0x2c3138, roughness: 0.24, metalness: 0.06, clearcoat: 0.75 }),
        accent: 0xcfdff5,
        background: 0x101826
      };
    }

    return {
      boardLight: physicalMaterial({
        color: 0x78d6ff,
        roughness: 0.08,
        metalness: 0.02,
        transmission: 0.82,
        thickness: 0.65,
        transparent: true,
        opacity: 0.8,
        ior: 1.28
      }),
      boardDark: physicalMaterial({
        color: 0x0b3151,
        roughness: 0.1,
        metalness: 0.18,
        transmission: 0.55,
        thickness: 0.7,
        transparent: true,
        opacity: 0.88,
        ior: 1.32
      }),
      boardLightSelected: physicalMaterial({
        color: 0xffeaa0,
        roughness: 0.06,
        metalness: 0.02,
        transmission: 0.74,
        transparent: true,
        opacity: 0.9
      }),
      boardDarkSelected: physicalMaterial({
        color: 0xf4ca52,
        roughness: 0.07,
        metalness: 0.22,
        transmission: 0.48,
        transparent: true,
        opacity: 0.92
      }),
      boardLightHighlight: physicalMaterial({
        color: 0xc3f1ff,
        roughness: 0.05,
        metalness: 0.03,
        transmission: 0.76,
        transparent: true,
        opacity: 0.88
      }),
      boardDarkHighlight: physicalMaterial({
        color: 0x4fb5ff,
        roughness: 0.07,
        metalness: 0.22,
        transmission: 0.55,
        transparent: true,
        opacity: 0.9
      }),
      whitePiece: physicalMaterial({
        color: 0xeaffff,
        roughness: 0.02,
        metalness: 0.06,
        transmission: 0.88,
        transparent: true,
        opacity: 0.72,
        ior: 1.27,
        thickness: 1.4
      }),
      blackPiece: physicalMaterial({
        color: 0x6fc2ff,
        roughness: 0.04,
        metalness: 0.18,
        transmission: 0.62,
        transparent: true,
        opacity: 0.84,
        ior: 1.3,
        thickness: 1.4
      }),
      accent: 0x8ddfff,
      background: 0x08111f
    };
  }

  private createPiece(piece: Piece, resources: ThemeResources): THREE.Group {
    const group = new THREE.Group();
    const material = piece.color === 'w' ? resources.whitePiece : resources.blackPiece;

    const base = mesh(new THREE.CylinderGeometry(0.43, 0.5, 0.18, 36), material);
    base.position.y = 0.09;
    group.add(base);

    switch (piece.type) {
      case 'p':
        group.add(stack(material, [
          ['cylinder', 0.22, 0.28, 0.62, 0.4],
          ['sphere', 0.24, 0, 0.87, 0]
        ]));
        break;
      case 'r':
        group.add(stack(material, [
          ['cylinder', 0.24, 0.32, 0.84, 0.5],
          ['cylinder', 0.34, 0.28, 0.2, 1.02]
        ]));
        for (let index = 0; index < 4; index += 1) {
          const crenel = mesh(new THREE.BoxGeometry(0.12, 0.14, 0.18), material);
          const angle = (Math.PI / 2) * index;
          crenel.position.set(Math.cos(angle) * 0.23, 1.18, Math.sin(angle) * 0.23);
          group.add(crenel);
        }
        break;
      case 'n': {
        const body = mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.72, 20), material);
        body.position.y = 0.48;
        group.add(body);

        const neck = mesh(new THREE.BoxGeometry(0.28, 0.72, 0.18), material);
        neck.position.set(0.08, 0.92, 0);
        neck.rotation.z = -0.35;
        group.add(neck);

        const head = mesh(new THREE.ConeGeometry(0.24, 0.58, 4), material);
        head.position.set(0.22, 1.28, 0);
        head.rotation.z = -Math.PI / 2;
        head.rotation.x = Math.PI / 4;
        group.add(head);
        break;
      }
      case 'b':
        group.add(stack(material, [
          ['cylinder', 0.2, 0.34, 0.9, 0.52],
          ['sphere', 0.22, 0, 1.03, 0],
          ['cone', 0.11, 0.32, 0.0, 1.33]
        ]));
        break;
      case 'q':
        group.add(stack(material, [
          ['cylinder', 0.24, 0.35, 1.05, 0.58],
          ['cylinder', 0.18, 0.22, 0.22, 1.14]
        ]));
        for (let index = 0; index < 5; index += 1) {
          const crown = mesh(new THREE.SphereGeometry(0.085, 20, 20), material);
          const angle = (Math.PI * 2 * index) / 5;
          crown.position.set(Math.cos(angle) * 0.22, 1.34, Math.sin(angle) * 0.22);
          group.add(crown);
        }
        break;
      case 'k': {
        group.add(stack(material, [
          ['cylinder', 0.24, 0.36, 1.1, 0.6],
          ['cylinder', 0.16, 0.2, 0.28, 1.22]
        ]));
        const vertical = mesh(new THREE.BoxGeometry(0.08, 0.38, 0.08), material);
        vertical.position.y = 1.48;
        group.add(vertical);
        const horizontal = mesh(new THREE.BoxGeometry(0.24, 0.08, 0.08), material);
        horizontal.position.y = 1.48;
        group.add(horizontal);
        break;
      }
      default:
        group.add(stack(material, [
          ['cylinder', 0.22, 0.32, 0.98, 0.54],
          ['sphere', 0.18, 0, 1.1, 0]
        ]));
        break;
    }

    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return group;
  }

  private handlePointerUp(event: PointerEvent): void {
    if (!this.interactive) {
      return;
    }

    if (this.pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 6) {
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const intersections = this.raycaster.intersectObjects([...this.piecesGroup.children, ...this.boardGroup.children], true);
    const target = intersections.find((item) => resolveSquare(item.object) !== null);
    if (!target) {
      return;
    }

    const square = resolveSquare(target.object);
    if (square !== null) {
      this.onSquareSelected(square);
    }
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private disposePieceMeshes(): void {
    this.piecesGroup.children.forEach((child) => disposeObjectGeometry(child));
  }
}

function squareToWorld(square: number, squareSize: number): { x: number; z: number } {
  return {
    x: (fileOf(square) - 3.5) * squareSize,
    z: (rankOf(square) - 3.5) * squareSize
  };
}

function fileOf(square: number): number {
  return square % 8;
}

function rankOf(square: number): number {
  return Math.floor(square / 8);
}

function physicalMaterial(parameters: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    ...parameters
  });
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(geometry, material);
}

function stack(
  material: THREE.Material,
  parts: Array<
    ['cylinder', number, number, number, number] | ['sphere', number, number, number, number] | ['cone', number, number, number, number]
  >
): THREE.Group {
  const group = new THREE.Group();

  for (const part of parts) {
    if (part[0] === 'cylinder') {
      const [, topRadius, bottomRadius, height, y] = part;
      const piece = mesh(new THREE.CylinderGeometry(topRadius, bottomRadius, height, 32), material);
      piece.position.y = y;
      group.add(piece);
    } else if (part[0] === 'sphere') {
      const [, radius, x, y, z] = part;
      const piece = mesh(new THREE.SphereGeometry(radius, 24, 24), material);
      piece.position.set(x, y, z);
      group.add(piece);
    } else {
      const [, radius, height, x, y] = part;
      const piece = mesh(new THREE.ConeGeometry(radius, height, 24), material);
      piece.position.set(x, y, 0);
      group.add(piece);
    }
  }

  return group;
}

function disposeObjectGeometry(object: THREE.Object3D): void {
  if (object instanceof THREE.Mesh) {
    object.geometry.dispose();
  }
  object.children.forEach((child) => disposeObjectGeometry(child));
}

function resolveSquare(object: THREE.Object3D | null): number | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.square === 'number') {
      return current.userData.square as number;
    }
    current = current.parent;
  }
  return null;
}

function createMarbleTexture(base: string, vein: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is unavailable');
  }

  context.fillStyle = base;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let line = 0; line < 22; line += 1) {
    context.beginPath();
    context.strokeStyle = line % 3 === 0 ? accent : vein;
    context.globalAlpha = 0.24 + Math.random() * 0.16;
    context.lineWidth = 2 + Math.random() * 4;
    let y = Math.random() * canvas.height;
    context.moveTo(0, y);
    for (let x = 0; x <= canvas.width; x += 16) {
      y += (Math.random() - 0.5) * 34;
      context.bezierCurveTo(x + 4, y + 12, x + 8, y - 12, x + 16, y);
    }
    context.stroke();
  }

  context.globalAlpha = 0.08;
  for (let noise = 0; noise < 1800; noise += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = Math.random() * 1.8;
    context.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#000000';
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.2, 1.2);
  return texture;
}
