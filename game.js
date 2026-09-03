// Game Variables
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 500, 1000);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 15, 30);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowShadowMap;
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(50, 50, 50);
directionalLight.castShadow = true;
directionalLight.shadow.camera.left = -100;
directionalLight.shadow.camera.right = 100;
directionalLight.shadow.camera.top = 100;
directionalLight.shadow.camera.bottom = -100;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
scene.add(directionalLight);

// Ground
const groundGeometry = new THREE.PlaneGeometry(200, 200);
const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x228B22 });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Game State
let gameState = {
    wallHealth: 100,
    maxWallHealth: 100,
    tanksDestroyed: 0,
    wave: 1,
    gameOver: false,
    gameOverReason: '',
    cannonCooldown: 0
};

let tanks = [];
let projectiles = [];
let cannonProjectile = null;

// Wall
class Wall {
    constructor() {
        this.health = 100;
        this.maxHealth = 100;
        this.bricks = [];
        this.createWall();
    }
    
    createWall() {
        const brickWidth = 2;
        const brickHeight = 2;
        const brickDepth = 1;
        const wallWidth = 20;
        const wallHeight = 12;
        
        for (let x = 0; x < wallWidth; x += brickWidth) {
            for (let y = 0; y < wallHeight; y += brickHeight) {
                const geometry = new THREE.BoxGeometry(brickWidth, brickHeight, brickDepth);
                const material = new THREE.MeshPhongMaterial({ color: 0xA0522D });
                const brick = new THREE.Mesh(geometry, material);
                brick.position.set(x - wallWidth/2, y + 1, -30);
                brick.castShadow = true;
                brick.receiveShadow = true;
                brick.active = true;
                scene.add(brick);
                this.bricks.push(brick);
            }
        }
    }
    
    takeDamage(amount) {
        this.health -= amount;
        gameState.wallHealth = this.health;
        updateWallHealthBar();
        
        if (this.health <= 0) {
            endGame('WALL DESTROYED!', 'Game Over');
        }
    }
    
    update() {
        // Bricks can be destroyed individually
    }
}

const wall = new Wall();

// Cannon
class Cannon {
    constructor() {
        this.group = new THREE.Group();
        this.position = new THREE.Vector3(0, 2, 0);
        this.group.position.copy(this.position);
        
        // Base
        const baseGeometry = new THREE.CylinderGeometry(3, 3, 1, 32);
        const baseMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.castShadow = true;
        base.receiveShadow = true;
        this.group.add(base);
        
        // Barrel
        const barrelGeometry = new THREE.CylinderGeometry(0.5, 0.5, 8, 32);
        const barrelMaterial = new THREE.MeshPhongMaterial({ color: 0x000000 });
        this.barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
        this.barrel.position.z = 4;
        this.barrel.castShadow = true;
        this.barrel.receiveShadow = true;
        this.barrel.rotationPivot = new THREE.Vector3(0, 0, 0);
        this.group.add(this.barrel);
        
        // Turret
        const turretGeometry = new THREE.CylinderGeometry(1.5, 1.5, 1.5, 32);
        const turretMaterial = new THREE.MeshPhongMaterial({ color: 0x444444 });
        const turret = new THREE.Mesh(turretGeometry, turretMaterial);
        turret.position.y = 0.5;
        turret.castShadow = true;
        turret.receiveShadow = true;
        this.group.add(turret);
        
        scene.add(this.group);
        
        this.horizontalAngle = 0;
        this.verticalAngle = Math.PI / 4;
    }
    
    aim(mouseX, mouseY) {
        // Convert mouse position to normalized coordinates
        const x = (mouseX / window.innerWidth) * 2 - 1;
        const y = -(mouseY / window.innerHeight) * 2 + 1;
        
        this.horizontalAngle = x * Math.PI / 2;
        this.verticalAngle = Math.max(0, Math.min(Math.PI / 2, Math.PI / 4 + y * 0.5));
        
        // Rotate barrel
        this.barrel.rotation.x = -this.verticalAngle;
        this.group.rotation.y = this.horizontalAngle;
    }
    
    fire() {
        if (gameState.cannonCooldown > 0) return;
        
        const startPos = new THREE.Vector3(0, 2, 0);
        const direction = new THREE.Vector3(
            Math.sin(this.horizontalAngle) * Math.cos(this.verticalAngle),
            Math.sin(this.verticalAngle),
            Math.cos(this.horizontalAngle) * Math.cos(this.verticalAngle)
        );
        
        cannonProjectile = new Projectile(startPos.clone(), direction.clone(), 60);
        gameState.cannonCooldown = 0.3; // 0.3 second cooldown
    }
}

const cannon = new Cannon();

// Tank
class Tank {
    constructor(laneIndex) {
        this.group = new THREE.Group();
        this.laneIndex = laneIndex;
        this.position = new THREE.Vector3(-80, 0, -50 + laneIndex * 15);
        this.group.position.copy(this.position);
        this.velocity = new THREE.Vector3(20, 0, 0); // Moving towards wall
        this.health = 1;
        this.maxHealth = 1;
        this.fireRate = 2; // seconds
        this.fireCountdown = Math.random() * this.fireRate;
        this.distanceToWall = 200;
        
        // Hull
        const hullGeometry = new THREE.BoxGeometry(3, 2, 5);
        const hullMaterial = new THREE.MeshPhongMaterial({ color: 0x2F4F4F });
        const hull = new THREE.Mesh(hullGeometry, hullMaterial);
        hull.position.y = 1.5;
        hull.castShadow = true;
        hull.receiveShadow = true;
        this.group.add(hull);
        this.hull = hull;
        
        // Turret
        const turretGeometry = new THREE.CylinderGeometry(1, 1, 0.8, 32);
        const turretMaterial = new THREE.MeshPhongMaterial({ color: 0x1a1a1a });
        this.turret = new THREE.Mesh(turretGeometry, turretMaterial);
        this.turret.position.y = 2.5;
        this.turret.castShadow = true;
        this.turret.receiveShadow = true;
        this.group.add(this.turret);
        
        // Cannon barrel
        const barrelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 3, 32);
        const barrelMaterial = new THREE.MeshPhongMaterial({ color: 0x000000 });
        this.barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
        this.barrel.position.set(0, 2.5, 1.5);
        this.barrel.castShadow = true;
        this.barrel.receiveShadow = true;
        this.group.add(this.barrel);
        
        // Tracks
        for (let x of [-1.5, 1.5]) {
            const trackGeometry = new THREE.BoxGeometry(0.5, 0.8, 5);
            const trackMaterial = new THREE.MeshPhongMaterial({ color: 0x000000 });
            const track = new THREE.Mesh(trackGeometry, trackMaterial);
            track.position.set(x, 0.8, 0);
            track.castShadow = true;
            track.receiveShadow = true;
            this.group.add(track);
        }
        
        scene.add(this.group);
    }
    
    update(deltaTime) {
        // Move towards wall
        this.group.position.add(this.velocity.clone().multiplyScalar(deltaTime));
        this.distanceToWall = Math.abs(this.group.position.x - (-10));
        
        // Fire when close enough
        this.fireCountdown -= deltaTime;
        if (this.distanceToWall < 30 && this.fireCountdown <= 0) {
            this.fire();
            this.fireCountdown = this.fireRate;
        }
    }
    
    fire() {
        const direction = new THREE.Vector3(-1, 0, 0);
        const startPos = this.group.position.clone().add(new THREE.Vector3(0, 2, 0));
        projectiles.push(new Projectile(startPos, direction, 30, true));
    }
    
    takeDamage(amount) {
        this.health -= amount;
        if (this.health <= 0) {
            this.destroy();
            gameState.tanksDestroyed++;
        }
    }
    
    destroy() {
        scene.remove(this.group);
        tanks = tanks.filter(t => t !== this);
        updateStats();
    }
}

// Projectile (both cannon and tank)
class Projectile {
    constructor(position, direction, speed, isTankFire = false) {
        this.position = position.clone();
        this.direction = direction.clone().normalize();
        this.speed = speed;
        this.isTankFire = isTankFire;
        this.lifetime = 30;
        
        const size = isTankFire ? 0.3 : 0.5;
        const color = isTankFire ? 0xFF6347 : 0xFFDD00;
        const geometry = new THREE.SphereGeometry(size, 16, 16);
        const material = new THREE.MeshPhongMaterial({ color: color, emissive: color });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;
        this.mesh.position.copy(this.position);
        scene.add(this.mesh);
        
        // Trail
        this.trailPoints = [this.position.clone()];
    }
    
    update(deltaTime) {
        const movement = this.direction.clone().multiplyScalar(this.speed * deltaTime);
        this.position.add(movement);
        this.mesh.position.copy(this.position);
        
        this.lifetime -= deltaTime;
        this.trailPoints.push(this.position.clone());
        if (this.trailPoints.length > 20) this.trailPoints.shift();
        
        // Check collisions
        this.checkCollisions();
        
        return this.lifetime > 0;
    }
    
    checkCollisions() {
        if (this.isTankFire) {
            // Tank projectile hitting wall
            if (this.position.x > -15 && this.position.x < -5) {
                wall.takeDamage(20);
                this.lifetime = -1;
            }
        } else {
            // Cannon projectile hitting tanks
            for (let tank of tanks) {
                const distance = this.position.distanceTo(tank.group.position);
                if (distance < 4) {
                    tank.takeDamage(1);
                    
                    // Knock tank far away
                    const knockbackDirection = tank.group.position.clone().sub(this.position).normalize();
                    tank.velocity = knockbackDirection.multiplyScalar(100);
                    
                    this.lifetime = -1;
                    break;
                }
            }
        }
    }
    
    destroy() {
        scene.remove(this.mesh);
    }
}

// Spawn waves
function spawnWave(waveNumber) {
    const tankCount = 2 + waveNumber;
    for (let i = 0; i < tankCount; i++) {
        tanks.push(new Tank(i));
    }
    updateStats();
}

// Input handling
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;

document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    cannon.aim(mouseX, mouseY);
});

document.addEventListener('click', () => {
    cannon.fire();
});

// Update UI
function updateWallHealthBar() {
    const percent = Math.max(0, (gameState.wallHealth / gameState.maxWallHealth) * 100);
    document.getElementById('healthFill').style.width = percent + '%';
    document.getElementById('healthText').textContent = `${Math.ceil(gameState.wallHealth)}/100`;
}

function updateStats() {
    document.getElementById('tanksDestroyed').textContent = gameState.tanksDestroyed;
    document.getElementById('tanksRemaining').textContent = tanks.length;
    document.getElementById('wave').textContent = gameState.wave;
}

function endGame(title, text) {
    gameState.gameOver = true;
    document.getElementById('gameOverTitle').textContent = title;
    document.getElementById('gameOverText').textContent = text;
    document.getElementById('gameOver').style.display = 'block';
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Game loop
const clock = new THREE.Clock();
spawnWave(gameState.wave);

function animate() {
    requestAnimationFrame(animate);
    
    const deltaTime = clock.getDelta();
    
    if (gameState.gameOver) {
        renderer.render(scene, camera);
        return;
    }
    
    // Update cannon cooldown
    if (gameState.cannonCooldown > 0) {
        gameState.cannonCooldown -= deltaTime;
    }
    
    // Update tanks
    for (let tank of tanks) {
        tank.update(deltaTime);
    }
    
    // Update projectiles
    let projectilesToRemove = [];
    for (let i = projectiles.length - 1; i >= 0; i--) {
        if (!projectiles[i].update(deltaTime)) {
            projectilesToRemove.push(i);
        }
    }
    
    for (let i of projectilesToRemove.reverse()) {
        projectiles[i].destroy();
        projectiles.splice(i, 1);
    }
    
    // Update cannon projectile
    if (cannonProjectile) {
        if (!cannonProjectile.update(deltaTime)) {
            cannonProjectile.destroy();
            cannonProjectile = null;
        }
    }
    
    // Check if wave is cleared
    if (tanks.length === 0 && !gameState.gameOver) {
        gameState.wave++;
        spawnWave(gameState.wave);
    }
    
    // Check win condition
    if (gameState.wallHealth > 0) {
        updateWallHealthBar();
    }
    
    renderer.render(scene, camera);
}

animate();
