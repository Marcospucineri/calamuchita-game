import * as THREE from 'three';
import { paintedMaterial } from '../render/PaintedMaterial';

/** Low-poly canopy and suspension lines, shared by local and remote players. */
export function createParachute(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Paracaídas';
  const geometry = new THREE.SphereGeometry(2.6, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  const positions = geometry.getAttribute('position');
  const colors: number[] = [];
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < positions.count; i += 3) {
    const u = (uv.getX(i) + uv.getX(i + 1) + uv.getX(i + 2)) / 3;
    const panel = Math.floor(u * 8);
    const color = new THREE.Color(panel % 2 ? 0xe8b440 : 0xf3e7c8);
    for (let j = 0; j < 3; j++) colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const canopy = new THREE.Mesh(geometry, paintedMaterial({ vertexColors: true, side: THREE.DoubleSide, brushAmount: .08 }));
  canopy.scale.y = .65; canopy.position.y = 4.1;
  group.add(canopy);
  const lines: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = i / 8 * Math.PI * 2;
    lines.push(new THREE.Vector3(0, 1.5, Math.sin(angle) > 0 ? .3 : -.3), new THREE.Vector3(Math.cos(angle) * 2.6, 4.1, Math.sin(angle) * 2.6));
  }
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), new THREE.LineBasicMaterial({ color: 0xeee2bd })));
  return group;
}
