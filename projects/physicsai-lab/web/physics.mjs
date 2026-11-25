const {PI:pi,sin,cos,exp,sqrt,tanh} = Math;
const ns = '∂ₜv + (v·∇)v + ∇p − νΔv = 0,  ∇·v = 0';
export const descriptions = {
  wave2d:['Wave equation','uₜₜ = λc² Δu','Standing wave · inverse wave coefficient','Standing-wave displacement and zero initial velocity'],
  heat2d:['Heat equation','uₜ = 0.1 Δu','Transient thermal diffusion','sin(πx) sin(πy)'],
  poisson2d:['Poisson equation','−Δu = 2π² sin(πx) sin(πy)','Steady potential under a distributed source','Steady state'],
  burgers:['Burgers equation','uₜ + u uₓ = (0.01/π) uₓₓ','Traveling viscous shock','Shock profile at t = 0'],
  kovasznay_forward:['Kovasznay flow · forward',ns.replace('∂ₜv + ',''),'Steady incompressible flow at ν = 0.025','Steady state'],
  kovasznay_inverse:['Kovasznay flow · inverse',ns.replace('∂ₜv + ',''),'Recover viscosity from a steady flow field','Steady state'],
  taylor_green:['Taylor–Green vortex',ns,'Decaying periodic incompressible vortex','Analytic velocity and pressure at t = 0'],
  darcy2d:['Darcy flow','−∇·(k∇u) = f,  k = 1 + ½ sin(πx) sin(πy)','Manufactured pressure field in a heterogeneous medium','Steady state'],
  reaction_diffusion:['Reaction–diffusion','uₜ = 0.01 Δu + u − u³ + f','Forced Allen–Cahn reaction and diffusion','0.2 sin(πx) sin(πy)']
};
export const axes=(eq,p)=>eq==='burgers'?['x','t']:p.domain.length===3?['x','y','t']:['x','y'];
export function exact(eq,[x,y,t],p) {
  const s=sin(pi*x)*sin(pi*y);
  switch(eq) {
  case 'wave2d': {
    const {kx,ky,wave_speed,lambda_target}=p.wave;
    return [sin(kx*pi*x)*sin(ky*pi*y)*cos(wave_speed*pi*sqrt(lambda_target*(kx*kx+ky*ky))*t)];
  }
  case 'heat2d': return [s*exp(-0.2*pi*pi*t)];
  case 'poisson2d': case 'darcy2d': return [s];
  case 'reaction_diffusion': return [0.2*s*exp(-t)];
  case 'burgers': return [0.5-0.5*tanh((x-0.5*y)/(4*0.01/pi))];
  case 'kovasznay_forward': case 'kovasznay_inverse': {
    const l=20-sqrt(400+4*pi*pi), e=exp(l*x);
    return [1-e*cos(2*pi*y), l/(2*pi)*e*sin(2*pi*y),0.5*(1-e*e)];
  }
  case 'taylor_green': {
    const e=exp(-0.02*t);
    return [-cos(x)*sin(y)*e,sin(x)*cos(y)*e,-0.25*(cos(2*x)+cos(2*y))*e*e];
  }
  default: throw new Error('Missing analytic adapter');
  }
}
